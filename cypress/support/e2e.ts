// Commands for driving the multi-phone simulator (public/sim.html).
//
// Each phone is an iframe running the web build of the app, tagged data-phone="<id>".
// cy.phone(id) yields that iframe's <body>, so everything after it is scoped to one phone:
//
//   cy.phone('maria').find(tid('offer')).should('contain.text', 'Ferry Building');

export type PhoneSpec = {
  role: 'rider' | 'driver';
  id: string;
  name: string;
  car?: string;
  plate?: string;
  rating?: number;
  /** Where the phone's mocked GPS puts it; downtown San Francisco if left out. */
  location?: { latitude: number; longitude: number };
  /** Drivers only: start in driving mode (the default) or offline. */
  driving?: boolean;
};

/**
 * One multi-phone scenario. Scenarios live in cypress/scenarios/ and are registered by
 * thin spec files in cypress/e2e/, so the same steps can back more than one spec.
 */
export type Scenario = { title: string; run: () => void };

export const defineScenario = (title: string, run: () => void): Scenario => ({ title, run });

export type DispatchState = {
  policy: AuctionPolicy;
  pricing: PricingConfig;
  devices: (PhoneSpec & { online: boolean; driving: boolean; jobs: string[]; position: { latitude: number; longitude: number } | null })[];
  rides: {
    id: string;
    riderId: string;
    status: 'auction' | 'matched' | 'completed' | 'unmatched' | 'cancelled';
    destination: string;
    rideTypeId: string;
    quotedFare: number;
    surge: number;
    pickup: { latitude: number; longitude: number };
    rounds: {
      number: number;
      price: number;
      final: boolean;
      closesAt: number;
      invited: string[];
      declined: string[];
      acceptedBy: string | null;
      lateAccepts: string[];
    }[];
    winnerId: string | null;
    fare: number | null;
  }[];
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /**
       * Clear all rides on the dispatch server and configure it for a scenario:
       * - policy: auction settings over TEST_POLICY (roundDurationMs is stretched on slow runs)
       * - pricing: pricing settings over TEST_PRICING
       * - rates: 'test' (default) for TEST_PRICING's simple UberX card, 'real' for the
       *   server's actual rate cards
       */
      resetDispatch(options?: ResetOptions): Chainable<DispatchState>;
      /** Load the simulator with these phones and wait until each is connected and on screen. */
      openPhones(phones: PhoneSpec[]): Chainable<void>;
      /** The <body> of one phone's iframe. */
      phone(id: string): Chainable<JQuery<HTMLElement>>;
      dispatchState(): Chainable<DispatchState>;
      /** Poll the dispatch server until `check` passes. */
      waitForDispatch(check: (state: DispatchState) => boolean, description: string): Chainable<DispatchState>;
      /** Rider searches for a place, picks it, and requests the default ride type. */
      requestRide(riderId: string, query: string, placeTitle: string): Chainable<void>;
      /** Driver accepts the suggested fare. `rider` picks the offer when the driver has several. */
      accept(driverId: string, options?: { rider?: string }): Chainable<void>;
      /** Driver passes on the suggested fare. */
      pass(driverId: string, options?: { rider?: string }): Chainable<void>;
      /**
       * Hold a phone's link to dispatch: it keeps running on what it last saw, what it sends
       * is queued and what it receives is buffered. Use it to stage races.
       */
      pausePhone(id: string): Chainable<void>;
      /** Send the phone's queued messages in order, then deliver what it missed. */
      resumePhone(id: string): Chainable<void>;
      /** Driver taps Start driving, and dispatch has registered it. */
      startDriving(driverId: string): Chainable<void>;
      /** Driver taps Go offline, and dispatch has registered it. */
      goOffline(driverId: string): Chainable<void>;
    }
  }
}

import type { AuctionPolicy, PricingConfig, PricingOverrides } from '../../src/lib/dispatch/protocol';
import '../../src/lib/dispatch/testHooks';
import { scaled, stepDelayMs, typeDelayMs } from './pace';

/** Selector for a React Native `testID`, which react-native-web renders as data-testid. */
export const tid = (id: string) => `[data-testid="${id}"]`;

const dispatchUrl = () => Cypress.expose('dispatchUrl') as string;

/**
 * The policy every scenario starts from, spelled out so tests don't depend on the server's
 * defaults. With the fixture's $11.00 quote, rounds offer $8.80, $9.35, $9.90, $10.45, $11.00.
 */
export const TEST_POLICY: AuctionPolicy = {
  startMultiplier: 0.8,
  stepMultiplier: 0.05,
  maxMultiplier: 1,
  roundDurationMs: 15_000,
};

/**
 * Pricing every scenario starts from. The simple UberX card makes the fixture's 5 km,
 * 10 min trip cost exactly $11.00 (2.50 + 10 × 0.85), and surge is off so prices don't
 * depend on how many requests a scenario makes. Drivers earn the default 75%.
 */
export const TEST_PRICING: PricingOverrides = {
  rateCards: { sf: { x: { baseFare: 2.5, perMile: 0, perMinute: 0.85, bookingFee: 0, minimumFare: 7 } } },
  surge: { enabled: false },
};

export type ResetOptions = {
  policy?: Partial<AuctionPolicy>;
  pricing?: PricingOverrides;
  rates?: 'test' | 'real';
};

Cypress.Commands.add('resetDispatch', ({ policy: policyOverrides = {}, pricing: pricingOverrides = {}, rates = 'test' } = {}) => {
  const policy = { ...TEST_POLICY, ...policyOverrides };
  policy.roundDurationMs = scaled(policy.roundDurationMs);
  const pricing: PricingOverrides = {
    rateCards: { ...(rates === 'test' ? TEST_PRICING.rateCards : {}), ...pricingOverrides.rateCards },
    surge: { ...TEST_PRICING.surge, ...pricingOverrides.surge },
    driverShare: pricingOverrides.driverShare,
    quoteTtlMs: pricingOverrides.quoteTtlMs,
  };
  return cy.request('POST', `${dispatchUrl()}/test/reset`, { policy, pricing }).its('body');
});

Cypress.Commands.add('dispatchState', () => {
  return cy.request({ url: `${dispatchUrl()}/state`, log: false }).its('body', { log: false });
});

Cypress.Commands.add('waitForDispatch', (check, description) => {
  Cypress.log({ name: 'waitForDispatch', message: description });
  const deadline = Date.now() + Cypress.config('defaultCommandTimeout');
  const poll = (): Cypress.Chainable<DispatchState> =>
    cy.dispatchState().then((state) => {
      if (check(state)) return cy.wrap(state, { log: false });
      if (Date.now() > deadline) throw new Error(`Timed out waiting for dispatch: ${description}`);
      return cy.wait(200, { log: false }).then(poll);
    });
  return poll();
});

Cypress.Commands.add('openPhones', (phones) => {
  const specs = phones.map((p) => {
    const options = {
      car: p.car,
      plate: p.plate,
      rating: p.rating,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      driving: p.driving === false ? 0 : undefined,
    };
    const extras = Object.entries(options)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value}`);
    return [p.role, p.id, p.name, ...extras].map((part) => encodeURIComponent(String(part))).join(':');
  });
  cy.visit(`/sim.html?phones=${encodeURIComponent(specs.join(','))}`);

  // The first load can wait on Metro compiling the web bundle.
  cy.wrap(null, { log: false, timeout: 120_000 }).should(() => {
    for (const p of phones) {
      const body = Cypress.$(`iframe[data-phone="${p.id}"]`)[0] as HTMLIFrameElement | undefined;
      const ready = p.role === 'driver' ? tid('driver-status') : tid('where-to');
      expect(body?.contentDocument?.querySelector(ready), `${p.id} rendered`).to.exist;
    }
  });
  const drives = (p: PhoneSpec) => p.role === 'driver' && p.driving !== false;
  for (const p of phones) {
    if (p.role === 'driver') cy.phone(p.id).find(tid('driver-status')).should('have.text', drives(p) ? 'Driving' : 'Offline');
  }
  cy.waitForDispatch(
    (state) => phones.every((p) => state.devices.some((d) => d.id === p.id && d.online && d.driving === drives(p))),
    'all phones connected, drivers in their starting mode',
  );
});

Cypress.Commands.add('phone', (id) => {
  Cypress.log({ name: 'phone', message: id });
  if (stepDelayMs() > 0) {
    // Show which phone is about to act, then give the viewer a moment to see it.
    cy.get('iframe[data-phone]', { log: false }).then((frames) => {
      frames.removeClass('acting').filter(`[data-phone="${id}"]`).addClass('acting');
    });
    cy.wait(stepDelayMs(), { log: false });
  }
  return cy
    .get(`iframe[data-phone="${id}"]`, { log: false })
    .its('0.contentDocument.body', { log: false })
    .then((body) => cy.wrap(body as HTMLElement, { log: false }));
});

Cypress.Commands.add('requestRide', (riderId, query, placeTitle) => {
  cy.phone(riderId).find(tid('where-to')).click();
  cy.phone(riderId).find(tid('destination-input')).type(query, { delay: typeDelayMs() });
  cy.phone(riderId).contains(placeTitle).click();
  cy.phone(riderId).find(tid('confirm-ride')).click();
  cy.phone(riderId).find(tid('ride-status')).should('have.text', 'Finding your driver');
});

function offerOn(driverId: string, rider?: string) {
  const offers = cy.phone(driverId).find(tid('offer'));
  return rider ? offers.filter(`:contains("${rider} →")`).should('have.length', 1) : offers.should('have.length', 1);
}

Cypress.Commands.add('accept', (driverId, options = {}) => {
  offerOn(driverId, options.rider).find(tid('accept-offer')).click();
});

Cypress.Commands.add('pass', (driverId, options = {}) => {
  offerOn(driverId, options.rider).find(tid('decline-offer')).click();
});

beforeEach(() => {
  // Keep scenarios independent of the live geocoder and router: every search finds the
  // Ferry Building and every route is 5 km / 10 min (so UberX is quoted $11.00).
  cy.intercept('GET', /photon\.komoot\.io\/api/, { fixture: 'photon-ferry-building.json' });
  cy.intercept('GET', /router\.project-osrm\.org\/route/, { fixture: 'osrm-5km.json' });
});

function dispatchLink(id: string) {
  return cy.phone(id).then((body) => {
    const link = body[0].ownerDocument.defaultView?.__dispatchLink;
    if (!link) throw new Error(`${id} has no dispatch link hook (web dev builds only)`);
    return link;
  });
}

function markPaused(id: string, paused: boolean) {
  cy.get(`iframe[data-phone="${id}"]`, { log: false }).invoke({ log: false }, 'toggleClass', 'paused', paused);
}

Cypress.Commands.add('pausePhone', (id) => {
  Cypress.log({ name: 'pausePhone', message: id });
  dispatchLink(id).then((link) => link.hold());
  markPaused(id, true);
});

Cypress.Commands.add('resumePhone', (id) => {
  Cypress.log({ name: 'resumePhone', message: id });
  dispatchLink(id).then((link) => link.release());
  markPaused(id, false);
});

function setDriving(driverId: string, driving: boolean) {
  cy.phone(driverId).find(tid(driving ? 'start-driving' : 'stop-driving')).click();
  cy.phone(driverId).find(tid('driver-status')).should('have.text', driving ? 'Driving' : 'Offline');
  cy.waitForDispatch(
    (state) => state.devices.some((d) => d.id === driverId && d.driving === driving),
    `${driverId} ${driving ? 'driving' : 'offline'}`,
  );
}

Cypress.Commands.add('startDriving', (driverId) => setDriving(driverId, true));
Cypress.Commands.add('goOffline', (driverId) => setDriving(driverId, false));
