// Wire protocol shared by the app and the dispatch server (server/dispatch.ts).
// Keep this file free of runtime imports so the server can import it type-only.

import type { Coord, Driver, Place } from '../types';

export type Role = 'rider' | 'driver';

export type DeviceProfile = {
  id: string;
  role: Role;
  name: string;
  /** Only meaningful for drivers. */
  car?: string;
  plate?: string;
  rating?: number;
};

export type RideRequest = {
  pickup: Coord;
  destination: Place;
  rideTypeId: string;
  distanceMeters: number;
  durationSeconds: number;
  /** The fare quoted to the rider. Each round's suggested price is a multiple of it. */
  quotedFare: number;
};

/**
 * How a ride's price auction runs. Prices are multiples of the rider's quoted fare:
 * round n suggests quote × (startMultiplier + (n − 1) × stepMultiplier), never above
 * quote × maxMultiplier. When the round at the cap finds no taker, the ride is unmatched.
 */
export type AuctionPolicy = {
  startMultiplier: number;
  stepMultiplier: number;
  /** null: keep raising the price until a driver accepts or the rider cancels. */
  maxMultiplier: number | null;
  roundDurationMs: number;
};

/**
 * auction   – a round is open: drivers are being offered the current price
 * matched   – a driver accepted; they're on the way / on trip
 * completed – the driver finished the trip
 * unmatched – the round at the price cap ended with no taker
 * cancelled – the rider cancelled during the auction
 */
export type RideStatus = 'auction' | 'matched' | 'completed' | 'unmatched' | 'cancelled';

/** What the rider sees about their own ride. */
export type RiderRideView = {
  id: string;
  status: RideStatus;
  destination: Place;
  rideTypeId: string;
  distanceMeters: number;
  durationSeconds: number;
  quotedFare: number;
  /** The current (or, once over, the last) round and the price it offered drivers. */
  round: number;
  price: number;
  closesAt: number;
  fare: number | null;
  driver: Driver | null;
  /** The matched driver is still on an earlier trip and will come after it. */
  driverFinishingTrip: boolean;
  completedAt: string | null;
};

/** The open round of an auction a driver has been invited to. */
export type DriverOfferView = {
  rideId: string;
  riderName: string;
  destination: Place;
  rideTypeId: string;
  distanceMeters: number;
  durationSeconds: number;
  round: number;
  /** The suggested fare; the driver accepts it or passes. */
  price: number;
  closesAt: number;
  /** The driver passed on this round; a later round may offer more. */
  declined: boolean;
};

export type DriverJobView = {
  rideId: string;
  riderName: string;
  destination: Place;
  fare: number;
};

export type DriverResult =
  | { rideId: string; outcome: 'lost' | 'cancelled' | 'expired' }
  | { rideId: string; outcome: 'completed'; fare: number };

export type Snapshot =
  | { role: 'rider'; ride: RiderRideView | null }
  | {
      role: 'driver';
      /** In driving mode, i.e. taking ride requests. */
      driving: boolean;
      offers: DriverOfferView[];
      /** The ride in progress. */
      job: DriverJobView | null;
      /** A ride accepted while on `job`, to start once it's done. */
      nextJob: DriverJobView | null;
      lastResult: DriverResult | null;
    };

export type ClientMessage =
  | { type: 'hello'; device: DeviceProfile }
  | { type: 'requestRide'; request: RideRequest }
  | { type: 'cancelRide' }
  /** Rider has seen the final state of their ride (trip done, or no match) and wants it cleared. */
  | { type: 'ackRide' }
  | { type: 'accept'; rideId: string; round: number }
  | { type: 'decline'; rideId: string; round: number }
  | { type: 'completeTrip'; rideId: string }
  /** Driver starts or stops taking ride requests. Sent on every (re)connect, too. */
  | { type: 'setDriving'; driving: boolean };

export type ServerMessage = { type: 'snapshot'; snapshot: Snapshot } | { type: 'error'; message: string };
