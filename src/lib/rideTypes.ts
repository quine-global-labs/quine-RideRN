// How each ride type is shown. Prices come from dispatch (server/pricing.mts), per city.
export type RideType = {
  id: string;
  name: string;
  description: string;
  seats: number;
  icon: string;
};

export const RIDE_TYPES: RideType[] = [
  { id: 'x', name: 'UberX', description: 'Affordable rides', seats: 4, icon: '🚗' },
  { id: 'comfort', name: 'Comfort', description: 'Newer cars, extra legroom', seats: 4, icon: '🚙' },
  { id: 'xl', name: 'UberXL', description: 'Rides for groups', seats: 6, icon: '🚐' },
  { id: 'black', name: 'Black', description: 'Premium rides', seats: 4, icon: '🚘' },
];

export function getRideType(id: string): RideType {
  return RIDE_TYPES.find((r) => r.id === id) ?? RIDE_TYPES[0];
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
