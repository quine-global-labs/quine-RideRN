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
  /** The fare quoted to the rider. Drivers can bid at or below it, never above. */
  maxFare: number;
};

/**
 * auction   – drivers are submitting sealed bids
 * matched   – lowest bid won; the driver is on the way / on trip
 * completed – the driver finished the trip
 * unmatched – the auction closed with no usable bid
 * cancelled – the rider cancelled during the auction
 */
export type RideStatus = 'auction' | 'matched' | 'completed' | 'unmatched' | 'cancelled';

/** What the rider sees about their own ride. Other drivers' bids are never exposed. */
export type RiderRideView = {
  id: string;
  status: RideStatus;
  destination: Place;
  rideTypeId: string;
  distanceMeters: number;
  durationSeconds: number;
  maxFare: number;
  closesAt: number;
  offerCount: number;
  fare: number | null;
  driver: Driver | null;
  completedAt: string | null;
};

/** An open auction a driver has been invited to. */
export type DriverOfferView = {
  rideId: string;
  riderName: string;
  destination: Place;
  rideTypeId: string;
  distanceMeters: number;
  durationSeconds: number;
  maxFare: number;
  closesAt: number;
  myBid: number | null;
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
  | { role: 'driver'; offers: DriverOfferView[]; job: DriverJobView | null; lastResult: DriverResult | null };

export type ClientMessage =
  | { type: 'hello'; device: DeviceProfile }
  | { type: 'requestRide'; request: RideRequest }
  | { type: 'cancelRide' }
  /** Rider has seen the final state of their ride (trip done, or no match) and wants it cleared. */
  | { type: 'ackRide' }
  | { type: 'bid'; rideId: string; amount: number }
  | { type: 'decline'; rideId: string }
  | { type: 'completeTrip'; rideId: string };

export type ServerMessage = { type: 'snapshot'; snapshot: Snapshot } | { type: 'error'; message: string };
