import AsyncStorage from '@react-native-async-storage/async-storage';

import { storagePrefix } from './dispatch/device';
import type { Place, Trip } from './types';

const TRIPS_KEY = `${storagePrefix}trips`;
const RECENT_PLACES_KEY = `${storagePrefix}recentPlaces`;
const MAX_RECENT_PLACES = 8;

async function readList<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

export function getTrips(): Promise<Trip[]> {
  return readList<Trip>(TRIPS_KEY);
}

export async function saveTrip(trip: Trip): Promise<void> {
  const trips = await getTrips();
  await AsyncStorage.setItem(TRIPS_KEY, JSON.stringify([trip, ...trips.filter((t) => t.id !== trip.id)]));
}

export function getRecentPlaces(): Promise<Place[]> {
  return readList<Place>(RECENT_PLACES_KEY);
}

export async function addRecentPlace(place: Place): Promise<void> {
  const places = await getRecentPlaces();
  const next = [place, ...places.filter((p) => p.id !== place.id)].slice(0, MAX_RECENT_PLACES);
  await AsyncStorage.setItem(RECENT_PLACES_KEY, JSON.stringify(next));
}
