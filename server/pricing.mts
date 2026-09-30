// Pricing model for the dispatch server: a basic model inspired by how Uber and Lyft are
// publicly known to price rides. Their real models are proprietary; this is not them.
//
//   fare = max(minimumFare, (baseFare + perMile × miles + perMinute × minutes) × surge + bookingFee)
//
// - Rate cards are per market (a city and its surroundings) and ride type; docs/pricing.md
//   has the sources.
// - Surge is per zone: recent ride requests against available drivers nearby.
// - The rider is quoted upfront; the driver earns a fixed share of what the rider pays.

import type { Coord } from '../src/lib/types';
import type { Market, PricingConfig, PricingOverrides, RateCard, SurgeConfig } from '../src/lib/dispatch/protocol';

const METERS_PER_MILE = 1609.344;

// San Francisco, 2026. UberX is RideWise's March 2026 card (checked against receipts);
// the minimum is TaxiFareFinder's. Uber doesn't publish rate cards any more, and the
// other tiers are estimates scaled from reported national averages and older SF rates.
const SAN_FRANCISCO: Record<string, RateCard> = {
  x: { baseFare: 2.5, perMile: 1.55, perMinute: 0.32, bookingFee: 3, minimumFare: 7 },
  comfort: { baseFare: 3, perMile: 1.85, perMinute: 0.38, bookingFee: 3, minimumFare: 9 },
  xl: { baseFare: 3, perMile: 2.1, perMinute: 0.4, bookingFee: 3, minimumFare: 9.25 },
  black: { baseFare: 8, perMile: 3.75, perMinute: 0.6, bookingFee: 3, minimumFare: 15 },
};

// Fairbanks, September 2026, from uphail.com. UberX and UberXL are Fairbanks's own rates;
// Fairbanks has no Comfort rates listed, so Comfort is Anchorage's from the same source.
// Neither city lists Black, so it isn't offered there.
const FAIRBANKS: Record<string, RateCard> = {
  x: { baseFare: 2.77, perMile: 1.86, perMinute: 0.31, bookingFee: 2.55, minimumFare: 8.43 },
  comfort: { baseFare: 3.74, perMile: 1.92, perMinute: 0.4, bookingFee: 3.58, minimumFare: 11.75 },
  xl: { baseFare: 3.25, perMile: 2.25, perMinute: 0.36, bookingFee: 2.55, minimumFare: 8.7 },
};

const MARKETS: Record<string, Market> = {
  sf: { name: 'San Francisco', center: { latitude: 37.7749, longitude: -122.4194 }, radiusKm: 60 },
  // Includes North Pole and Fort Wainwright.
  fairbanks: { name: 'Fairbanks', center: { latitude: 64.8378, longitude: -147.7164 }, radiusKm: 60 },
};

export const DEFAULT_PRICING: PricingConfig = {
  markets: MARKETS,
  defaultMarket: 'sf',
  rateCards: { sf: SAN_FRANCISCO, fairbanks: FAIRBANKS },
  surge: {
    enabled: true,
    // About 2 km across in San Francisco.
    zoneSizeDegrees: 0.02,
    // Uber's surge was measured updating every 5 minutes in 2015; a minute feels closer to today.
    intervalMs: 60_000,
    demandWindowMs: 10 * 60_000,
    // Surge starts once requests outnumber drivers, adding 0.5× per extra request per driver.
    threshold: 1,
    sensitivity: 0.5,
    step: 0.1,
    maxMultiplier: 3,
  },
  // Reported take rates run about 25–29% (Uber); Lyft guarantees drivers at least 70%.
  driverShare: 0.75,
  quoteTtlMs: 2 * 60_000,
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function mergePricing(base: PricingConfig, overrides: PricingOverrides = {}): PricingConfig {
  const rateCards: PricingConfig['rateCards'] = {};
  for (const market of new Set([...Object.keys(base.rateCards), ...Object.keys(overrides.rateCards ?? {})])) {
    rateCards[market] = { ...base.rateCards[market] };
    for (const [type, card] of Object.entries(overrides.rateCards?.[market] ?? {})) {
      rateCards[market][type] = { ...rateCards[market][type], ...card } as RateCard;
    }
  }
  return {
    markets: { ...base.markets, ...overrides.markets },
    defaultMarket: overrides.defaultMarket ?? base.defaultMarket,
    rateCards,
    surge: { ...base.surge, ...overrides.surge },
    driverShare: overrides.driverShare ?? base.driverShare,
    quoteTtlMs: overrides.quoteTtlMs ?? base.quoteTtlMs,
  };
}

export function validatePricing(p: PricingConfig): string | null {
  for (const [market, cards] of Object.entries(p.rateCards)) {
    for (const [type, card] of Object.entries(cards)) {
      for (const [field, value] of Object.entries(card)) {
        if (!(typeof value === 'number' && value >= 0)) return `rateCards.${market}.${type}.${field} must be a number ≥ 0`;
      }
    }
  }
  for (const [id, market] of Object.entries(p.markets)) {
    if (!p.rateCards[id]) return `markets.${id} has no rate cards`;
    if (!(market.radiusKm > 0)) return `markets.${id}.radiusKm must be more than 0`;
  }
  if (!p.markets[p.defaultMarket]) return `defaultMarket "${p.defaultMarket}" isn't one of the markets`;
  if (!(p.driverShare > 0 && p.driverShare <= 1)) return 'driverShare must be more than 0 and at most 1';
  if (!(p.quoteTtlMs > 0)) return 'quoteTtlMs must be more than 0';
  const s = p.surge;
  if (!(s.zoneSizeDegrees > 0)) return 'surge.zoneSizeDegrees must be more than 0';
  if (!(s.step > 0)) return 'surge.step must be more than 0';
  if (!(s.maxMultiplier >= 1)) return 'surge.maxMultiplier must be at least 1';
  return null;
}

/** The market whose rate cards apply to a pickup: the nearest one in range, else the default. */
export function marketFor(pickup: Coord, pricing: PricingConfig): string {
  let best: { id: string; km: number } | null = null;
  for (const [id, market] of Object.entries(pricing.markets)) {
    const km = distanceKm(pickup, market.center);
    if (km <= market.radiusKm && (!best || km < best.km)) best = { id, km };
  }
  return best?.id ?? pricing.defaultMarket;
}

function distanceKm(a: Coord, b: Coord): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The upfront fare for one ride type. */
export function fareFor(card: RateCard, distanceMeters: number, durationSeconds: number, surge: number): number {
  const miles = distanceMeters / METERS_PER_MILE;
  const minutes = durationSeconds / 60;
  const ride = card.baseFare + card.perMile * miles + card.perMinute * minutes;
  return round2(Math.max(card.minimumFare, ride * surge + card.bookingFee));
}

export const earningsFor = (fare: number, pricing: PricingConfig) => round2(fare * pricing.driverShare);

/** The surge zone a point falls in: a square of the grid, as "row:column". */
export function zoneOf(point: Coord, surge: SurgeConfig): string {
  const size = surge.zoneSizeDegrees;
  return `${Math.floor(point.latitude / size)}:${Math.floor(point.longitude / size)}`;
}

/** The surge multiplier for a zone with this many recent requests and available drivers. */
export function surgeMultiplier(demand: number, supply: number, surge: SurgeConfig): number {
  if (!surge.enabled) return 1;
  // With no drivers at all, count as if there were one: every request is unmet demand.
  const ratio = demand / Math.max(supply, 1);
  const raw = 1 + (ratio - surge.threshold) * surge.sensitivity;
  // Round down to the step, with a little slack so 1.5 doesn't become 1.4 from float error.
  const stepped = Math.floor((raw + 1e-9) / surge.step) * surge.step;
  return round2(Math.min(surge.maxMultiplier, Math.max(1, stepped)));
}
