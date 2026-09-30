import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { DeviceProfile, Role } from './protocol';

const DISPATCH_PORT = 8787;

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

// On web, a phone in the multi-phone simulator is configured by its URL, e.g.
// /driver?device=maria&role=driver&name=Maria&car=Toyota%20Prius&plate=7KDL294
// Read once at startup, before the router starts rewriting the URL.
function profileFromUrl(): DeviceProfile | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
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

export const device: DeviceProfile = fromUrl ?? { id: randomId('rider'), role: 'rider', name: 'You' };

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
