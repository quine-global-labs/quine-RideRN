import type { Coord, Route } from './types';

// OSRM's public demo server: keyless driving directions, fine for development only.
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';

export async function fetchRoute(from: Coord, to: Coord, signal?: AbortSignal): Promise<Route> {
  try {
    const path = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
    const res = await fetch(`${OSRM_URL}${path}?overview=full&geometries=geojson`, { signal });
    if (!res.ok) throw new Error(`Routing failed (${res.status})`);
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) throw new Error('No route found');

    return {
      coordinates: route.geometry.coordinates.map(([longitude, latitude]: [number, number]) => ({ latitude, longitude })),
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      approximate: false,
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    return straightLineRoute(from, to);
  }
}

function straightLineRoute(from: Coord, to: Coord): Route {
  const distanceMeters = haversineMeters(from, to);
  const averageSpeedMetersPerSecond = 30_000 / 3600; // ~30 km/h city driving
  return {
    coordinates: [from, to],
    distanceMeters,
    durationSeconds: distanceMeters / averageSpeedMetersPerSecond,
    approximate: true,
  };
}

function haversineMeters(a: Coord, b: Coord): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
