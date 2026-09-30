import type { Route } from './types';

export type RideType = {
  id: string;
  name: string;
  description: string;
  seats: number;
  icon: string;
  baseFare: number;
  perKm: number;
  perMinute: number;
  minimumFare: number;
};

export const RIDE_TYPES: RideType[] = [
  { id: 'x', name: 'UberX', description: 'Affordable rides', seats: 4, icon: '🚗', baseFare: 2.5, perKm: 1.1, perMinute: 0.3, minimumFare: 7 },
  { id: 'comfort', name: 'Comfort', description: 'Newer cars, extra legroom', seats: 4, icon: '🚙', baseFare: 3.5, perKm: 1.4, perMinute: 0.35, minimumFare: 9 },
  { id: 'xl', name: 'UberXL', description: 'Rides for groups', seats: 6, icon: '🚐', baseFare: 4, perKm: 1.8, perMinute: 0.45, minimumFare: 11 },
  { id: 'black', name: 'Black', description: 'Premium rides', seats: 4, icon: '🚘', baseFare: 7, perKm: 2.6, perMinute: 0.6, minimumFare: 18 },
];

export function getRideType(id: string): RideType {
  return RIDE_TYPES.find((r) => r.id === id) ?? RIDE_TYPES[0];
}

export function priceFor(ride: RideType, route: Route): number {
  const km = route.distanceMeters / 1000;
  const minutes = route.durationSeconds / 60;
  const fare = ride.baseFare + km * ride.perKm + minutes * ride.perMinute;
  return Math.max(ride.minimumFare, Math.round(fare * 100) / 100);
}

export function formatPrice(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
