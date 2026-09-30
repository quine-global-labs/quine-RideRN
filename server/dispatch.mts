// Development dispatch server: matches riders to drivers with a sealed-bid price auction.
//
// When a rider requests a ride, every online, idle driver is invited to bid at or below
// the fare the rider was quoted. The auction closes when every invited driver has bid or
// declined, or when the auction window runs out. The lowest bid wins (ties go to the
// earliest bid) and the rider pays the winning bid.
//
// Phones talk to it over a WebSocket; each change pushes a fresh snapshot to every device.
// A small HTTP API (GET /state, POST /test/*) lets test scenarios reset and inspect it.
//
// Run: node server/dispatch.mts   (PORT, AUCTION_MS env vars optional)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import type {
  ClientMessage,
  DeviceProfile,
  DriverResult,
  RideRequest,
  RideStatus,
  ServerMessage,
  Snapshot,
} from '../src/lib/dispatch/protocol';

const PORT = Number(process.env.PORT ?? 8787);
const DEFAULT_AUCTION_MS = Number(process.env.AUCTION_MS ?? 15_000);

type Bid = { driverId: string; amount: number; at: number };

type Ride = {
  id: string;
  riderId: string;
  request: RideRequest;
  status: RideStatus;
  createdAt: number;
  closesAt: number;
  invited: string[];
  bids: Map<string, Bid>;
  declined: Set<string>;
  winnerId: string | null;
  fare: number | null;
  completedAt: string | null;
  /** The rider has dismissed this ride; it no longer shows up in their snapshot. */
  acked: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

type Device = { profile: DeviceProfile; sockets: Set<WebSocket> };

const config = { auctionDurationMs: DEFAULT_AUCTION_MS };
const devices = new Map<string, Device>();
const rides = new Map<string, Ride>();
const lastResults = new Map<string, DriverResult>();
let nextRideId = 1;

// ---------------------------------------------------------------------------
// Queries

const isOnline = (id: string) => (devices.get(id)?.sockets.size ?? 0) > 0;

function currentJob(driverId: string): Ride | undefined {
  for (const ride of rides.values()) if (ride.status === 'matched' && ride.winnerId === driverId) return ride;
  return undefined;
}

const isBusy = (driverId: string) => currentJob(driverId) !== undefined;

function riderRide(riderId: string): Ride | undefined {
  let latest: Ride | undefined;
  for (const ride of rides.values()) {
    if (ride.riderId === riderId && ride.status !== 'cancelled' && !ride.acked) latest = ride;
  }
  return latest;
}

function driverProfile(id: string): DeviceProfile {
  return devices.get(id)?.profile ?? { id, role: 'driver', name: id };
}

function snapshotFor(profile: DeviceProfile): Snapshot {
  if (profile.role === 'rider') {
    const ride = riderRide(profile.id);
    if (!ride) return { role: 'rider', ride: null };
    const driver = ride.winnerId ? driverProfile(ride.winnerId) : null;
    return {
      role: 'rider',
      ride: {
        id: ride.id,
        status: ride.status,
        destination: ride.request.destination,
        rideTypeId: ride.request.rideTypeId,
        distanceMeters: ride.request.distanceMeters,
        durationSeconds: ride.request.durationSeconds,
        maxFare: ride.request.maxFare,
        closesAt: ride.closesAt,
        offerCount: ride.bids.size,
        fare: ride.fare,
        driver: driver && {
          name: driver.name,
          rating: driver.rating ?? 5,
          car: driver.car ?? 'Toyota Camry · Silver',
          plate: driver.plate ?? 'SIM0000',
        },
        completedAt: ride.completedAt,
      },
    };
  }

  const job = currentJob(profile.id);
  const offers = job
    ? []
    : [...rides.values()]
        .filter((r) => r.status === 'auction' && r.invited.includes(profile.id))
        .map((r) => ({
          rideId: r.id,
          riderName: devices.get(r.riderId)?.profile.name ?? 'Rider',
          destination: r.request.destination,
          rideTypeId: r.request.rideTypeId,
          distanceMeters: r.request.distanceMeters,
          durationSeconds: r.request.durationSeconds,
          maxFare: r.request.maxFare,
          closesAt: r.closesAt,
          myBid: r.bids.get(profile.id)?.amount ?? null,
          declined: r.declined.has(profile.id),
        }));
  return {
    role: 'driver',
    offers,
    job: job
      ? {
          rideId: job.id,
          riderName: devices.get(job.riderId)?.profile.name ?? 'Rider',
          destination: job.request.destination,
          fare: job.fare!,
        }
      : null,
    lastResult: lastResults.get(profile.id) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Messaging

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast() {
  for (const device of devices.values()) {
    const message: ServerMessage = { type: 'snapshot', snapshot: snapshotFor(device.profile) };
    for (const socket of device.sockets) send(socket, message);
  }
}

class DispatchError extends Error {}

// ---------------------------------------------------------------------------
// Auction

function openAuction(riderId: string, request: RideRequest): Ride {
  if (!(request.maxFare > 0)) throw new DispatchError('Invalid fare');
  const existing = riderRide(riderId);
  if (existing && (existing.status === 'auction' || existing.status === 'matched')) {
    throw new DispatchError('You already have a ride in progress');
  }
  // A rider starting over implicitly dismisses whatever finished ride they were looking at.
  if (existing) existing.acked = true;

  const now = Date.now();
  const invited = [...devices.values()]
    .filter((d) => d.profile.role === 'driver' && isOnline(d.profile.id) && !isBusy(d.profile.id))
    .map((d) => d.profile.id);

  const ride: Ride = {
    id: `ride-${nextRideId++}`,
    riderId,
    request,
    status: 'auction',
    createdAt: now,
    closesAt: now + config.auctionDurationMs,
    invited,
    bids: new Map(),
    declined: new Set(),
    winnerId: null,
    fare: null,
    completedAt: null,
    acked: false,
    timer: null,
  };
  rides.set(ride.id, ride);
  ride.timer = setTimeout(() => {
    closeAuction(ride);
    broadcast();
  }, config.auctionDurationMs);
  log(`${ride.id} opened by ${riderId}, max $${request.maxFare.toFixed(2)}, invited [${invited.join(', ')}]`);
  closeIfEveryoneResponded(ride);
  return ride;
}

/** Drivers who were invited, are still available, and haven't answered yet. */
function pendingDrivers(ride: Ride): string[] {
  return ride.invited.filter((id) => !ride.bids.has(id) && !ride.declined.has(id) && !isBusy(id));
}

function closeIfEveryoneResponded(ride: Ride) {
  if (ride.status === 'auction' && pendingDrivers(ride).length === 0) closeAuction(ride);
}

function closeAuction(ride: Ride) {
  if (ride.status !== 'auction') return;
  if (ride.timer) clearTimeout(ride.timer);
  ride.timer = null;

  // Lowest bid wins; ties go to whoever bid first. Drivers who won another auction
  // in the meantime can't take this one.
  const ranked = [...ride.bids.values()].sort((a, b) => a.amount - b.amount || a.at - b.at);
  const winner = ranked.find((bid) => !isBusy(bid.driverId));

  for (const id of ride.invited) {
    if (id === winner?.driverId || ride.declined.has(id)) continue;
    lastResults.set(id, { rideId: ride.id, outcome: ride.bids.has(id) ? 'lost' : 'expired' });
  }

  if (winner) {
    ride.status = 'matched';
    ride.winnerId = winner.driverId;
    ride.fare = winner.amount;
    lastResults.delete(winner.driverId);
    log(`${ride.id} won by ${winner.driverId} at $${winner.amount.toFixed(2)} (${ranked.length} bid(s))`);
  } else {
    ride.status = 'unmatched';
    log(`${ride.id} closed with no winner`);
  }

  // A driver who just became busy no longer blocks other auctions from closing early.
  for (const other of rides.values()) if (other !== ride) closeIfEveryoneResponded(other);
}

function auctionAwaitingResponse(rideId: string, driverId: string): Ride {
  const ride = rides.get(rideId);
  if (!ride || ride.status !== 'auction') throw new DispatchError('This auction has closed');
  if (!ride.invited.includes(driverId)) throw new DispatchError('You were not invited to this auction');
  if (ride.bids.has(driverId) || ride.declined.has(driverId)) throw new DispatchError('You already responded');
  if (isBusy(driverId)) throw new DispatchError('Finish your current trip first');
  return ride;
}

// ---------------------------------------------------------------------------
// Message handling

function handle(device: Device, message: ClientMessage) {
  const { id, role } = device.profile;
  switch (message.type) {
    case 'hello':
      return; // handled at connection time
    case 'requestRide':
      if (role !== 'rider') throw new DispatchError('Only riders can request rides');
      openAuction(id, message.request);
      return;
    case 'cancelRide': {
      const ride = riderRide(id);
      if (!ride || ride.status !== 'auction') throw new DispatchError('Nothing to cancel');
      if (ride.timer) clearTimeout(ride.timer);
      ride.status = 'cancelled';
      for (const driverId of ride.invited) lastResults.set(driverId, { rideId: ride.id, outcome: 'cancelled' });
      log(`${ride.id} cancelled by rider`);
      return;
    }
    case 'ackRide': {
      const ride = riderRide(id);
      if (ride && ride.status !== 'auction' && ride.status !== 'matched') ride.acked = true;
      return;
    }
    case 'bid': {
      if (role !== 'driver') throw new DispatchError('Only drivers can bid');
      const ride = auctionAwaitingResponse(message.rideId, id);
      const amount = Math.round(message.amount * 100) / 100;
      if (!(amount > 0)) throw new DispatchError('Bid must be more than $0');
      if (amount > ride.request.maxFare) {
        throw new DispatchError(`Bid can't be more than $${ride.request.maxFare.toFixed(2)}`);
      }
      ride.bids.set(id, { driverId: id, amount, at: Date.now() });
      log(`${ride.id} bid $${amount.toFixed(2)} from ${id}`);
      closeIfEveryoneResponded(ride);
      return;
    }
    case 'decline': {
      if (role !== 'driver') throw new DispatchError('Only drivers can decline');
      const ride = auctionAwaitingResponse(message.rideId, id);
      ride.declined.add(id);
      log(`${ride.id} declined by ${id}`);
      closeIfEveryoneResponded(ride);
      return;
    }
    case 'completeTrip': {
      const ride = rides.get(message.rideId);
      if (!ride || ride.status !== 'matched' || ride.winnerId !== id) throw new DispatchError('No such trip');
      ride.status = 'completed';
      ride.completedAt = new Date().toISOString();
      lastResults.set(id, { rideId: ride.id, outcome: 'completed', fare: ride.fare! });
      log(`${ride.id} completed by ${id}`);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP: state inspection and test control

function reset(options: { auctionDurationMs?: number }) {
  for (const ride of rides.values()) if (ride.timer) clearTimeout(ride.timer);
  rides.clear();
  lastResults.clear();
  nextRideId = 1;
  config.auctionDurationMs = options.auctionDurationMs ?? DEFAULT_AUCTION_MS;
  log(`reset (auction window ${config.auctionDurationMs}ms)`);
}

function publicState() {
  return {
    config,
    devices: [...devices.values()].map(({ profile }) => ({
      ...profile,
      online: isOnline(profile.id),
      busy: profile.role === 'driver' && isBusy(profile.id),
    })),
    rides: [...rides.values()].map((r) => ({
      id: r.id,
      riderId: r.riderId,
      status: r.status,
      destination: r.request.destination.title,
      maxFare: r.request.maxFare,
      closesAt: r.closesAt,
      invited: r.invited,
      bids: [...r.bids.values()],
      declined: [...r.declined],
      winnerId: r.winnerId,
      fare: r.fare,
    })),
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function handleHttp(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') return json(204, null);

  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/state') return json(200, publicState());

    if (req.method === 'POST' && url.pathname === '/test/reset') {
      const body = await readJson(req);
      reset({ auctionDurationMs: typeof body.auctionDurationMs === 'number' ? body.auctionDurationMs : undefined });
      broadcast();
      return json(200, publicState());
    }

    const close = url.pathname.match(/^\/test\/rides\/([^/]+)\/close$/);
    if (req.method === 'POST' && close) {
      const ride = rides.get(close[1]);
      if (!ride) return json(404, { error: 'No such ride' });
      closeAuction(ride);
      broadcast();
      return json(200, publicState());
    }

    json(404, { error: 'Not found' });
  } catch (err) {
    json(400, { error: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------------------
// WebSocket

const server = createServer((req, res) => void handleHttp(req, res));
const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  let device: Device | null = null;

  socket.on('message', (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return send(socket, { type: 'error', message: 'Malformed message' });
    }

    if (message.type === 'hello') {
      const sockets = devices.get(message.device.id)?.sockets ?? new Set<WebSocket>();
      sockets.add(socket);
      device = { profile: message.device, sockets };
      devices.set(message.device.id, device);
      log(`${message.device.role} ${message.device.id} connected`);
      broadcast();
      return;
    }
    if (!device) return send(socket, { type: 'error', message: 'Say hello first' });

    try {
      handle(device, message);
    } catch (err) {
      if (!(err instanceof DispatchError)) throw err;
      send(socket, { type: 'error', message: err.message });
    }
    broadcast();
  });

  socket.on('close', () => {
    if (!device) return;
    device.sockets.delete(socket);
    if (device.sockets.size === 0) log(`${device.profile.role} ${device.profile.id} disconnected`);
    broadcast();
  });
});

function log(message: string) {
  console.log(`[dispatch] ${message}`);
}

server.listen(PORT, () => log(`listening on :${PORT}`));
