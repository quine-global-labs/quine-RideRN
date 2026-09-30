import type { Coord, Place } from './types';

// Photon is a free, keyless OpenStreetMap geocoder built for search-as-you-type.
// Swap this for Google Places / Mapbox in production.
const PHOTON_URL = 'https://photon.komoot.io/api/';

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    state?: string;
    country?: string;
  };
};

export async function searchPlaces(query: string, near: Coord | null, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({ q: query, limit: '8', lang: 'en' });
  if (near) {
    params.set('lat', String(near.latitude));
    params.set('lon', String(near.longitude));
  }

  const res = await fetch(`${PHOTON_URL}?${params}`, { signal });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const data: { features: PhotonFeature[] } = await res.json();

  return data.features.map((f, i) => {
    const p = f.properties;
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    const title = p.name ?? (street || p.city || 'Unnamed place');
    const subtitle = [p.name ? street : null, p.city, p.state, p.country]
      .filter((part) => part && part !== title)
      .join(', ');
    const [longitude, latitude] = f.geometry.coordinates;
    return {
      id: `${p.osm_type ?? 'x'}${p.osm_id ?? i}`,
      title,
      subtitle,
      coordinate: { latitude, longitude },
    };
  });
}
