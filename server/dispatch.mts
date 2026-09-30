// Development dispatch server: matches riders to drivers with a rising-price auction.
//
// When a rider requests a ride, every online driver in driving mode with room for another
// ride (a driver can have one ride in progress and one queued) is offered the same
// suggested fare and can accept or pass. The first driver to accept wins the ride at that price.
// If the round ends with no taker (everyone passed, or time ran out), a new round opens
// at a higher price, until a driver accepts or the price cap is reached. Prices, step,
// cap and round length come from the auction policy (see AuctionPolicy).
//
// What the rider is quoted comes from the pricing model (pricing.mts): rate cards, surge
// by zone, and the driver's share. Riders ask for a quote, then book against it.
//
// Phones talk to it over a WebSocket; each change pushes a fresh snapshot to every device.
// A small HTTP API (GET /state, POST /test/*) lets test scenarios reset and inspect it.
//
// Run: node server/dispatch.mts
// Env: PORT, AUCTION_START, AUCTION_STEP, AUCTION_MAX ("none" for no cap), AUCTION_ROUND_MS,
//      PRICING_FILE (JSON of pricing overrides, e.g. other cities' rate cards)

import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import type {
  AuctionPolicy,
  ClientMessage,
  DeviceProfile,
  DriverResult,
  PricingConfig,
  PricingOverrides,
  Quote,
  QuoteRequest,
  RideStatus,
  ServerMessage,
  Snapshot,
} from '../src/lib/dispatch/protocol';
import type { Coord, Place } from '../src/lib/types';
import {
  DEFAULT_PRICING,
  earningsFor,
  fareFor,
  marketFor,
  mergePricing,
  surgeMultiplier,
  validatePricing,
  zoneOf,
} from './pricing.mts';

const PORT = Number(process.env.PORT ?? 8787);

/** The ride in progress plus one queued: a driver on a trip can line up their next ride. */
const MAX_RIDES_PER_DRIVER = 2;

// Placeholder pricing until there's a real model: start at 80% of the quote and add 5%
// of it per round, up to the quote itself, so the rider never pays more than quoted.
const DEFAULT_POLICY: AuctionPolicy = {
  startMultiplier: Number(process.env.AUCTION_START ?? 0.8),
  stepMultiplier: Number(process.env.AUCTION_STEP ?? 0.05),
  maxMultiplier: process.env.AUCTION_MAX === 'none' ? null : Number(process.env.AUCTION_MAX ?? 1),
  roundDurationMs: Number(process.env.AUCTION_ROUND_MS ?? 15_000),
};

// Pricing as the server starts: the defaults, plus any overrides from PRICING_FILE.
const STARTUP_PRICING = mergePricing(
  DEFAULT_PRICING,
  process.env.PRICING_FILE ? (JSON.parse(readFileSync(process.env.PRICING_FILE, 'utf8')) as PricingOverrides) : {},
);

type RideRequest = {
  pickup: Coord;
  destination: Place;
  rideTypeId: string;
  distanceMeters: number;
  durationSeconds: number;
  /** What the rider was quoted for this ride type. Each round's price is a multiple of it. */
  quotedFare: number;
  surge: number;
};

type StoredQuote = Quote & { riderId: string; request: QuoteRequest };

type Round = {
  number: number;
  price: number;
  /** The last round the policy allows; no taker here means the ride is unmatched. */
  final: boolean;
  closesAt: number;
  invited: string[];
  declined: Set<string>;
  acceptedBy: string | null;
  /** Drivers whose accept arrived after acceptedBy's, in arrival order. */
  lateAccepts: string[];
};

type Ride = {
  id: string;
  riderId: string;
  request: RideRequest;
  policy: AuctionPolicy;
  status: RideStatus;
  rounds: Round[];
  winnerId: string | null;
  fare: number | null;
  /** When a driver accepted; orders a driver's rides into in progress, then queued. */
  matchedAt: number | null;
  completedAt: string | null;
  /** The rider has dismissed this ride; it no longer shows up in their snapshot. */
  acked: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

type Device = {
  profile: DeviceProfile;
  sockets: Set<WebSocket>;
  /** Drivers only: in driving mode, i.e. taking ride requests. */
  driving: boolean;
  /** Drivers only: last reported position, for counting supply by surge zone. */
  position: Coord | null;
};

let policy: AuctionPolicy = { ...DEFAULT_POLICY };
let pricing: PricingConfig = STARTUP_PRICING;
const devices = new Map<string, Device>();
const rides = new Map<string, Ride>();
const lastResults = new Map<string, DriverResult>();
const quotes = new Map<string, StoredQuote>();
/** When and where rides were requested, for surge demand. */
let requestLog: { at: number; zone: string }[] = [];
const surgeCache = new Map<string, { multiplier: number; at: number }>();
let nextRideId = 1;
let nextQuoteId = 1;

// ---------------------------------------------------------------------------
// Pricing

/**
 * The auction policy for a new ride. One policy for everything today; this is where
 * pricing would vary by locality, ride type, time of day and so on.
 */
function policyFor(_request: RideRequest): AuctionPolicy {
  return policy;
}

function validatePolicy(p: AuctionPolicy) {
  if (!(p.startMultiplier > 0)) throw new DispatchError('startMultiplier must be more than 0');
  if (!(p.stepMultiplier > 0)) throw new DispatchError('stepMultiplier must be more than 0');
  if (p.maxMultiplier !== null && !(p.maxMultiplier > 0)) throw new DispatchError('maxMultiplier must be more than 0, or null');
  if (!(p.roundDurationMs > 0)) throw new DispatchError('roundDurationMs must be more than 0');
}

/** The price a round offers, and whether the policy allows any round after it. */
function roundPrice(ride: Ride, number: number): { price: number; final: boolean } {
  const { startMultiplier, stepMultiplier, maxMultiplier } = ride.policy;
  const uncapped = startMultiplier + (number - 1) * stepMultiplier;
  // A tiny tolerance so 0.8 + 4 × 0.05 counts as reaching a cap of 1.
  const final = maxMultiplier !== null && uncapped >= maxMultiplier - 1e-9;
  const multiplier = maxMultiplier === null ? uncapped : Math.min(uncapped, maxMultiplier);
  return { price: Math.round(ride.request.quotedFare * multiplier * 100) / 100, final };
}

// ---------------------------------------------------------------------------
// Surge and quotes

function surgeIn(zone: string): number {
  const now = Date.now();
  const cached = surgeCache.get(zone);
  if (cached && now - cached.at < pricing.surge.intervalMs) return cached.multiplier;

  requestLog = requestLog.filter((r) => now - r.at < pricing.surge.demandWindowMs);
  const demand = requestLog.filter((r) => r.zone === zone).length;
  const supply = [...devices.values()].filter(
    (d) => d.profile.role === 'driver' && d.position && zoneOf(d.position, pricing.surge) === zone && isAvailable(d.profile.id),
  ).length;
  const multiplier = surgeMultiplier(demand, supply, pricing.surge);
  surgeCache.set(zone, { multiplier, at: now });
  return multiplier;
}

function quote(riderId: string, request: QuoteRequest): StoredQuote {
  const surge = surgeIn(zoneOf(request.pickup, pricing.surge));
  const cards = pricing.rateCards[marketFor(request.pickup, pricing)];
  const fares = Object.fromEntries(
    Object.entries(cards).map(([type, card]) => [type, fareFor(card, request.distanceMeters, request.durationSeconds, surge)]),
  );
  const stored: StoredQuote = {
    id: `quote-${nextQuoteId++}`,
    destinationId: request.destination.id,
    surge,
    expiresAt: Date.now() + pricing.quoteTtlMs,
    fares,
    riderId,
    request,
  };
  // A rider only ever books against their latest quote.
  for (const [id, q] of quotes) if (q.riderId === riderId) quotes.delete(id);
  quotes.set(stored.id, stored);
  return stored;
}

function latestQuote(riderId: string): StoredQuote | undefined {
  for (const q of quotes.values()) if (q.riderId === riderId) return q;
  return undefined;
}

// ---------------------------------------------------------------------------
// Queries

const isOnline = (id: string) => (devices.get(id)?.sockets.size ?? 0) > 0;

/** A driver's matched rides: the one in progress first, then the queued one. */
function jobs(driverId: string): Ride[] {
  return [...rides.values()]
    .filter((ride) => ride.status === 'matched' && ride.winnerId === driverId)
    .sort((a, b) => a.matchedAt! - b.matchedAt!);
}

const isDriving = (driverId: string) => devices.get(driverId)?.driving ?? false;

/** Driving, with room for another ride. Doesn't care whether the phone is connected right now. */
const canTakeRides = (driverId: string) => isDriving(driverId) && jobs(driverId).length < MAX_RIDES_PER_DRIVER;

const isAvailable = (driverId: string) => isOnline(driverId) && canTakeRides(driverId);

const currentRound = (ride: Ride) => ride.rounds[ride.rounds.length - 1];

function riderRide(riderId: string): Ride | undefined {
  let latest: Ride | undefined;
  for (const ride of rides.values()) {
    if (ride.riderId === riderId && ride.status !== 'cancelled' && !ride.acked) latest = ride;
  }
  return latest;
}

function availableDrivers(): string[] {
  return [...devices.values()]
    .filter((d) => d.profile.role === 'driver' && isAvailable(d.profile.id))
    .map((d) => d.profile.id);
}

function driverProfile(id: string): DeviceProfile {
  return devices.get(id)?.profile ?? { id, role: 'driver', name: id };
}

const riderName = (ride: Ride) => devices.get(ride.riderId)?.profile.name ?? 'Rider';

function snapshotFor(profile: DeviceProfile): Snapshot {
  if (profile.role === 'rider') {
    const ride = riderRide(profile.id);
    const q = latestQuote(profile.id);
    const quoteView = q ? { id: q.id, destinationId: q.destinationId, surge: q.surge, expiresAt: q.expiresAt, fares: q.fares } : null;
    if (!ride) return { role: 'rider', ride: null, quote: quoteView };
    const round = currentRound(ride);
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
        quotedFare: ride.request.quotedFare,
        round: round.number,
        price: round.price,
        closesAt: round.closesAt,
        fare: ride.fare,
        driverFinishingTrip: ride.winnerId !== null && jobs(ride.winnerId)[0] !== ride && ride.status === 'matched',
        driver: driver && {
          name: driver.name,
          rating: driver.rating ?? 5,
          car: driver.car ?? 'Toyota Camry · Silver',
          plate: driver.plate ?? 'SIM0000',
        },
        completedAt: ride.completedAt,
      },
      quote: quoteView,
    };
  }

  const [job, nextJob] = jobs(profile.id);
  const offers = !canTakeRides(profile.id)
    ? []
    : [...rides.values()]
        .filter((r) => r.status === 'auction' && currentRound(r).invited.includes(profile.id))
        .map((r) => {
          const round = currentRound(r);
          return {
            rideId: r.id,
            riderName: riderName(r),
            destination: r.request.destination,
            rideTypeId: r.request.rideTypeId,
            distanceMeters: r.request.distanceMeters,
            durationSeconds: r.request.durationSeconds,
            round: round.number,
            price: round.price,
            earnings: earningsFor(round.price, pricing),
            closesAt: round.closesAt,
            declined: round.declined.has(profile.id),
          };
        });
  const jobView = (ride: Ride | undefined) =>
    ride
      ? {
          rideId: ride.id,
          riderName: riderName(ride),
          destination: ride.request.destination,
          fare: ride.fare!,
          earnings: earningsFor(ride.fare!, pricing),
        }
      : null;
  return {
    role: 'driver',
    driving: isDriving(profile.id),
    offers,
    job: jobView(job),
    nextJob: jobView(nextJob),
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

function requestRide(riderId: string, quoteId: string, rideTypeId: string): Ride {
  const q = quotes.get(quoteId);
  if (!q || q.riderId !== riderId || q.expiresAt <= Date.now()) {
    // Hand the rider fresh prices to confirm, rather than booking at old ones.
    const latest = latestQuote(riderId);
    if (latest) quote(riderId, latest.request);
    throw new DispatchError('Prices have changed. Check the new price and try again.');
  }
  const quotedFare = q.fares[rideTypeId];
  if (!(quotedFare > 0)) throw new DispatchError('That ride type isn’t available here');
  const request: RideRequest = { ...q.request, rideTypeId, quotedFare, surge: q.surge };

  const existing = riderRide(riderId);
  if (existing && (existing.status === 'auction' || existing.status === 'matched')) {
    throw new DispatchError('You already have a ride in progress');
  }
  // A rider starting over implicitly dismisses whatever finished ride they were looking at.
  if (existing) existing.acked = true;

  const ride: Ride = {
    id: `ride-${nextRideId++}`,
    riderId,
    request,
    policy: policyFor(request),
    status: 'auction',
    rounds: [],
    winnerId: null,
    fare: null,
    matchedAt: null,
    completedAt: null,
    acked: false,
    timer: null,
  };
  rides.set(ride.id, ride);
  quotes.delete(q.id);
  requestLog.push({ at: Date.now(), zone: zoneOf(request.pickup, pricing.surge) });
  log(`${ride.id} requested by ${riderId}, ${rideTypeId} quoted $${quotedFare.toFixed(2)}${q.surge > 1 ? ` (surge ${q.surge}×)` : ''}`);
  startRound(ride);
  return ride;
}

function startRound(ride: Ride) {
  const number = ride.rounds.length + 1;
  const { price, final } = roundPrice(ride, number);
  const round: Round = {
    number,
    price,
    final,
    closesAt: Date.now() + ride.policy.roundDurationMs,
    invited: availableDrivers(),
    declined: new Set(),
    acceptedBy: null,
    lateAccepts: [],
  };
  ride.rounds.push(round);
  ride.timer = setTimeout(() => {
    endRound(ride);
    broadcast();
  }, ride.policy.roundDurationMs);
  log(`${ride.id} round ${number}${final ? ' (final)' : ''} at $${price.toFixed(2)}, offered to [${round.invited.join(', ')}]`);
  // With nobody to ask, the round still runs its clock: a driver may come online meanwhile.
  endRoundIfEveryonePassed(ride);
}

/** Drivers in the current round who can still take the ride and haven't passed. */
function undecidedDrivers(ride: Ride): string[] {
  const round = currentRound(ride);
  return round.invited.filter((id) => !round.declined.has(id) && canTakeRides(id));
}

function endRoundIfEveryonePassed(ride: Ride) {
  if (ride.status !== 'auction') return;
  // A round nobody was offered just runs its clock; there's no one whose answer to await.
  if (currentRound(ride).invited.length > 0 && undecidedDrivers(ride).length === 0) endRound(ride);
}

/** The current round ended with no taker: raise the price, or give up at the cap. */
function endRound(ride: Ride) {
  if (ride.status !== 'auction') return;
  if (ride.timer) clearTimeout(ride.timer);
  ride.timer = null;

  const round = currentRound(ride);
  if (!round.final) return startRound(ride);

  ride.status = 'unmatched';
  for (const id of round.invited) {
    if (!round.declined.has(id)) lastResults.set(id, { rideId: ride.id, outcome: 'expired' });
  }
  log(`${ride.id} unmatched after ${ride.rounds.length} round(s)`);
}

function accept(ride: Ride, driverId: string) {
  const round = currentRound(ride);
  if (ride.timer) clearTimeout(ride.timer);
  ride.timer = null;
  round.acceptedBy = driverId;
  ride.status = 'matched';
  ride.winnerId = driverId;
  ride.fare = round.price;
  ride.matchedAt = Date.now();
  lastResults.delete(driverId);
  for (const id of round.invited) {
    if (id !== driverId && !round.declined.has(id)) lastResults.set(id, { rideId: ride.id, outcome: 'lost' });
  }
  log(`${ride.id} accepted by ${driverId} at $${round.price.toFixed(2)} in round ${round.number}`);

  // If that filled this driver up, rounds that were only waiting on them can move on.
  endOpenRoundsIfEveryonePassed();
}

function endOpenRoundsIfEveryonePassed() {
  for (const ride of rides.values()) endRoundIfEveryonePassed(ride);
}

/** The open round a driver is answering, checked against the round they saw. */
function roundToAnswer(rideId: string, roundNumber: number, driverId: string): Ride {
  const ride = rides.get(rideId);
  if (!ride || ride.status !== 'auction') throw new DispatchError('This ride is no longer available');
  const round = currentRound(ride);
  if (round.number !== roundNumber) throw new DispatchError('The price changed; check the new offer');
  if (!round.invited.includes(driverId)) throw new DispatchError('You were not offered this ride');
  if (round.declined.has(driverId)) throw new DispatchError('You already passed on this price');
  if (!isDriving(driverId)) throw new DispatchError('Start driving to take rides');
  if (!canTakeRides(driverId)) throw new DispatchError('You already have a ride queued');
  return ride;
}

// ---------------------------------------------------------------------------
// Message handling

function handle(device: Device, message: ClientMessage) {
  const { id, role } = device.profile;
  switch (message.type) {
    case 'hello':
      return; // handled at connection time
    case 'requestQuote':
      if (role !== 'rider') throw new DispatchError('Only riders can get quotes');
      quote(id, message.request);
      return;
    case 'requestRide':
      if (role !== 'rider') throw new DispatchError('Only riders can request rides');
      requestRide(id, message.quoteId, message.rideTypeId);
      return;
    case 'cancelRide': {
      const ride = riderRide(id);
      if (!ride || ride.status !== 'auction') throw new DispatchError('Nothing to cancel');
      if (ride.timer) clearTimeout(ride.timer);
      ride.status = 'cancelled';
      for (const driverId of currentRound(ride).invited) lastResults.set(driverId, { rideId: ride.id, outcome: 'cancelled' });
      log(`${ride.id} cancelled by rider`);
      return;
    }
    case 'ackRide': {
      const ride = riderRide(id);
      if (ride && ride.status !== 'auction' && ride.status !== 'matched') ride.acked = true;
      return;
    }
    case 'accept': {
      if (role !== 'driver') throw new DispatchError('Only drivers can accept rides');
      // Accepts are settled in arrival order: once one lands, later ones for that round lose.
      const round = rides.get(message.rideId)?.rounds[message.round - 1];
      if (round?.acceptedBy && round.acceptedBy !== id) {
        round.lateAccepts.push(id);
        log(`${message.rideId} round ${round.number} late accept from ${id}; ${round.acceptedBy} was first`);
        throw new DispatchError('Another driver already took this ride');
      }
      accept(roundToAnswer(message.rideId, message.round, id), id);
      return;
    }
    case 'decline': {
      if (role !== 'driver') throw new DispatchError('Only drivers can pass on rides');
      const ride = roundToAnswer(message.rideId, message.round, id);
      currentRound(ride).declined.add(id);
      log(`${ride.id} round ${message.round} passed by ${id}`);
      endRoundIfEveryonePassed(ride);
      return;
    }
    case 'completeTrip': {
      const [current] = jobs(id);
      if (!current || current.id !== message.rideId) throw new DispatchError('That isn’t your current trip');
      current.status = 'completed';
      current.completedAt = new Date().toISOString();
      lastResults.set(id, { rideId: current.id, outcome: 'completed', earnings: earningsFor(current.fare!, pricing) });
      log(`${current.id} completed by ${id}`);
      // Room for another ride again.
      inviteToOpenRounds(id);
      return;
    }
    case 'setDriving': {
      if (role !== 'driver') throw new DispatchError('Only drivers can drive');
      if (device.driving === message.driving) return;
      device.driving = message.driving;
      log(`${id} ${message.driving ? 'started' : 'stopped'} driving`);
      // Starting joins rounds already open; stopping may leave a round with nobody to wait on.
      if (message.driving) inviteToOpenRounds(id);
      else endOpenRoundsIfEveryonePassed();
      return;
    }
    case 'setPosition': {
      if (role !== 'driver') return;
      device.position = message.position;
      return;
    }
  }
}

/** A driver who becomes available mid-round is offered that round too. */
function inviteToOpenRounds(driverId: string) {
  if (!isOnline(driverId) || !canTakeRides(driverId)) return;
  for (const ride of rides.values()) {
    const round = ride.status === 'auction' ? currentRound(ride) : undefined;
    if (round && !round.invited.includes(driverId)) round.invited.push(driverId);
  }
}

// ---------------------------------------------------------------------------
// HTTP: state inspection and test control

function reset(overrides: Partial<AuctionPolicy>, pricingOverrides: PricingOverrides) {
  const next = { ...DEFAULT_POLICY, ...overrides };
  validatePolicy(next);
  const nextPricing = mergePricing(STARTUP_PRICING, pricingOverrides);
  const problem = validatePricing(nextPricing);
  if (problem) throw new DispatchError(problem);
  for (const ride of rides.values()) if (ride.timer) clearTimeout(ride.timer);
  rides.clear();
  lastResults.clear();
  quotes.clear();
  requestLog = [];
  surgeCache.clear();
  pricing = nextPricing;
  // Phones say whether they're driving when they connect; start everyone off the road.
  for (const device of devices.values()) device.driving = false;
  nextRideId = 1;
  policy = next;
  log(`reset, policy ${JSON.stringify(policy)}`);
}

function publicState() {
  return {
    policy,
    pricing,
    devices: [...devices.values()].map(({ profile, position }) => ({
      ...profile,
      online: isOnline(profile.id),
      driving: profile.role === 'driver' && isDriving(profile.id),
      jobs: profile.role === 'driver' ? jobs(profile.id).map((ride) => ride.id) : [],
      position,
    })),
    rides: [...rides.values()].map((r) => ({
      id: r.id,
      riderId: r.riderId,
      status: r.status,
      destination: r.request.destination.title,
      rideTypeId: r.request.rideTypeId,
      quotedFare: r.request.quotedFare,
      surge: r.request.surge,
      pickup: r.request.pickup,
      rounds: r.rounds.map((round) => ({ ...round, declined: [...round.declined] })),
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
      reset((body.policy ?? {}) as Partial<AuctionPolicy>, (body.pricing ?? {}) as PricingOverrides);
      broadcast();
      return json(200, publicState());
    }

    const endRoundMatch = url.pathname.match(/^\/test\/rides\/([^/]+)\/end-round$/);
    if (req.method === 'POST' && endRoundMatch) {
      const ride = rides.get(endRoundMatch[1]);
      if (!ride) return json(404, { error: 'No such ride' });
      endRound(ride);
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
      const known = devices.get(message.device.id);
      const sockets = known?.sockets ?? new Set<WebSocket>();
      sockets.add(socket);
      device = { profile: message.device, sockets, driving: known?.driving ?? false, position: known?.position ?? null };
      devices.set(message.device.id, device);
      if (message.device.role === 'driver') inviteToOpenRounds(message.device.id);
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

validatePolicy(DEFAULT_POLICY);
const startupProblem = validatePricing(STARTUP_PRICING);
if (startupProblem) throw new Error(`Invalid pricing: ${startupProblem}`);
server.listen(PORT, () => log(`listening on :${PORT}, policy ${JSON.stringify(DEFAULT_POLICY)}`));
