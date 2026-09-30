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

/** What a rider sends to be quoted: the trip, as their app routed it. */
export type QuoteRequest = {
  pickup: Coord;
  destination: Place;
  distanceMeters: number;
  durationSeconds: number;
};

/**
 * Upfront prices for one trip, one per ride type, set by dispatch. Booking a ride uses
 * the quote's price for that type, as long as the quote hasn't expired.
 */
export type Quote = {
  id: string;
  /** The destination this quote is for, so a stale quote is never shown for a new one. */
  destinationId: string;
  /** The surge multiplier in the pickup's zone when quoted; 1 means none. */
  surge: number;
  expiresAt: number;
  fares: Record<string, number>;
};

/** A city's prices for one ride type. Distance is in miles, as US rate cards quote it. */
export type RateCard = {
  baseFare: number;
  perMile: number;
  perMinute: number;
  /** Flat fee per trip; not multiplied by surge. */
  bookingFee: number;
  minimumFare: number;
};

/**
 * Surge: each zone's price multiplier, from recent ride requests (demand) against the
 * available drivers there (supply). Recomputed at most every `intervalMs` per zone.
 * multiplier = 1 + (demand / supply − threshold) × sensitivity, rounded down to `step`,
 * between 1 and `maxMultiplier`.
 */
export type SurgeConfig = {
  enabled: boolean;
  /** Zones are a grid of squares this many degrees of latitude/longitude across. */
  zoneSizeDegrees: number;
  intervalMs: number;
  /** How far back ride requests count toward demand. */
  demandWindowMs: number;
  threshold: number;
  sensitivity: number;
  step: number;
  maxMultiplier: number;
};

/** A place with its own prices: pickups within `radiusKm` of `center` use its rate cards. */
export type Market = { name: string; center: Coord; radiusKm: number };

export type PricingConfig = {
  markets: Record<string, Market>;
  /** For pickups outside every market, so the app still prices rides anywhere in development. */
  defaultMarket: string;
  /** Rate cards by market id, then ride type id. A ride type without a card isn't offered there. */
  rateCards: Record<string, Record<string, RateCard>>;
  surge: SurgeConfig;
  /** The driver's share of what the rider pays; the rest is the platform's cut. */
  driverShare: number;
  quoteTtlMs: number;
};

/** Partial pricing settings, merged over the defaults (per city and ride type for rates). */
export type PricingOverrides = {
  markets?: Record<string, Market>;
  defaultMarket?: string;
  rateCards?: Record<string, Record<string, Partial<RateCard>>>;
  surge?: Partial<SurgeConfig>;
  driverShare?: number;
  quoteTtlMs?: number;
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
  /** The suggested fare the rider would pay; the driver accepts it or passes. */
  price: number;
  /** What the driver would earn at that price. */
  earnings: number;
  closesAt: number;
  /** The driver passed on this round; a later round may offer more. */
  declined: boolean;
};

export type DriverJobView = {
  rideId: string;
  riderName: string;
  destination: Place;
  fare: number;
  earnings: number;
};

export type DriverResult =
  | { rideId: string; outcome: 'lost' | 'cancelled' | 'expired' }
  | { rideId: string; outcome: 'completed'; earnings: number };

export type Snapshot =
  | { role: 'rider'; ride: RiderRideView | null; quote: Quote | null }
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
  | { type: 'requestQuote'; request: QuoteRequest }
  /** Book a ride type at the price in one of this rider's unexpired quotes. */
  | { type: 'requestRide'; quoteId: string; rideTypeId: string }
  | { type: 'cancelRide' }
  /** Rider has seen the final state of their ride (trip done, or no match) and wants it cleared. */
  | { type: 'ackRide' }
  | { type: 'accept'; rideId: string; round: number }
  | { type: 'decline'; rideId: string; round: number }
  | { type: 'completeTrip'; rideId: string }
  /** Driver starts or stops taking ride requests. Sent on every (re)connect, too. */
  | { type: 'setDriving'; driving: boolean }
  /** Where a driver is, for counting supply in surge zones. */
  | { type: 'setPosition'; position: Coord };

export type ServerMessage = { type: 'snapshot'; snapshot: Snapshot } | { type: 'error'; message: string };
