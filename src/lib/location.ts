import type { Coord } from './types';

// Used as the pickup point when location permission is denied or still pending, and as
// simulated phones' position when their URL doesn't give one.
export const DEFAULT_LOCATION: Coord = { latitude: 37.7749, longitude: -122.4194 };
