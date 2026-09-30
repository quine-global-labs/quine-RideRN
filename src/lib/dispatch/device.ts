import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { DEFAULT_LOCATION } from '../location';
import type { Coord } from '../types';
import type { DeviceProfile, Role } from './protocol';

const DISPATCH_PORT = 8787;

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

// On web, a phone in the multi-phone simulator is configured by its URL, e.g.
// /driver?device=maria&role=driver&name=Maria&car=Toyota%20Prius&plate=7KDL294&lat=37.78&lng=-122.41
// Read once at startup, before the router starts rewriting the URL.
const params =
  Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;

function profileFromUrl(): DeviceProfile | null {
  if (!params) return null;
  const id = params.get('device');
  if (!id) return null;
  const role: Role = params.get('role') === 'driver' ? 'driver' : 'rider';
  const rating = Number(params.get('rating'));
  return {
    id,
    role,
    name: params.get('name') ?? id,
    car: params.get('car') ?? undefined,
    plate: params.get('plate') ?? undefined,
    rating: rating > 0 ? rating : undefined,
  };
}

const fromUrl = profileFromUrl();

/** Which app this build is (app.config.ts, from APP_VARIANT): the rider app or the driver app. */
export const appVariant: Role = Constants.expoConfig?.extra?.appVariant === 'driver' ? 'driver' : 'rider';

/** Who this phone is. In the simulator each phone's URL says; otherwise it follows the app variant. */
export const device: DeviceProfile = fromUrl ?? {
  id: randomId(appVariant),
  role: appVariant,
  name: appVariant === 'driver' ? 'Driver' : 'You',
};

/** Simulated drivers can start out in driving mode (`driving=1`); real drivers start offline. */
export const startsDriving = fromUrl?.role === 'driver' && params?.get('driving') === '1';

/**
 * Simulated phones never use the real location API: there's nobody to answer a permission
 * prompt, and the test machine's position would leak into scenarios. They sit at the
 * position in their URL (`lat`, `lng`), or downtown San Francisco. Null outside the simulator.
 */
export const simulatedLocation: Coord | null = fromUrl ? locationFromUrl() : null;

function locationFromUrl(): Coord {
  const latitude = Number(params?.get('lat'));
  const longitude = Number(params?.get('lng'));
  const valid = params?.has('lat') && params.has('lng') && Number.isFinite(latitude) && Number.isFinite(longitude);
  return valid ? { latitude, longitude } : DEFAULT_LOCATION;
}

/** Simulated phones share one browser origin, so each one namespaces its local storage. */
export const storagePrefix = fromUrl ? `${fromUrl.id}:` : '';

// The dispatch server runs next to the dev server, so reuse the dev server's host:
// that works for simulators, emulators, physical devices and the browser alike.
function dispatchUrl(): string {
  if (process.env.EXPO_PUBLIC_DISPATCH_URL) return process.env.EXPO_PUBLIC_DISPATCH_URL;
  const host =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.hostname
      : (Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost');
  return `ws://${host}:${DISPATCH_PORT}`;
}

export const DISPATCH_URL = dispatchUrl();
