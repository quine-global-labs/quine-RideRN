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
};

/**
 * One multi-phone scenario. Scenarios live in cypress/scenarios/ and are registered by
 * thin spec files in cypress/e2e/, so the same steps can back more than one spec.
 */
export type Scenario = { title: string; run: () => void };

export const defineScenario = (title: string, run: () => void): Scenario => ({ title, run });

export type DispatchState = {
  config: { auctionDurationMs: number };
  devices: (PhoneSpec & { online: boolean; busy: boolean })[];
  rides: {
    id: string;
    riderId: string;
    status: 'auction' | 'matched' | 'completed' | 'unmatched' | 'cancelled';
    destination: string;
    maxFare: number;
    closesAt: number;
    invited: string[];
    bids: { driverId: string; amount: number; at: number }[];
    declined: string[];
    winnerId: string | null;
    fare: number | null;
  }[];
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /** Clear all rides on the dispatch server. `auctionDurationMs` sets the bidding window. */
      resetDispatch(options?: { auctionDurationMs?: number }): Chainable<DispatchState>;
      /** Load the simulator with these phones and wait until each is connected and on screen. */
      openPhones(phones: PhoneSpec[]): Chainable<void>;
      /** The <body> of one phone's iframe. */
      phone(id: string): Chainable<JQuery<HTMLElement>>;
      dispatchState(): Chainable<DispatchState>;
      /** Poll the dispatch server until `check` passes. */
      waitForDispatch(check: (state: DispatchState) => boolean, description: string): Chainable<DispatchState>;
      /** Rider searches for a place, picks it, and requests the default ride type. */
      requestRide(riderId: string, query: string, placeTitle: string): Chainable<void>;
      /** Driver enters a sealed bid. `rider` picks the offer when the driver has several. */
      bid(driverId: string, amount: number, options?: { rider?: string }): Chainable<void>;
      /** Driver passes on an offer. */
      pass(driverId: string, options?: { rider?: string }): Chainable<void>;
    }
  }
}

import { isSlow, scaled, stepDelayMs, typeDelayMs } from './pace';

/** Selector for a React Native `testID`, which react-native-web renders as data-testid. */
export const tid = (id: string) => `[data-testid="${id}"]`;

const dispatchUrl = () => Cypress.expose('dispatchUrl') as string;

// The dispatch server's default auction window (AUCTION_MS); slow runs stretch it.
const DEFAULT_AUCTION_MS = 15_000;

Cypress.Commands.add('resetDispatch', (options = {}) => {
  const auctionDurationMs = options.auctionDurationMs ?? (isSlow() ? scaled(DEFAULT_AUCTION_MS) : undefined);
  return cy.request('POST', `${dispatchUrl()}/test/reset`, { auctionDurationMs }).its('body');
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
  const specs = phones.map((p) =>
    [p.role, p.id, p.name, p.car ?? '', p.plate ?? '', p.rating ?? ''].map((part) => encodeURIComponent(String(part))).join(':'),
  );
  cy.visit(`/sim.html?phones=${encodeURIComponent(specs.join(','))}`);

  // The first load can wait on Metro compiling the web bundle.
  cy.wrap(null, { log: false, timeout: 120_000 }).should(() => {
    for (const p of phones) {
      const body = Cypress.$(`iframe[data-phone="${p.id}"]`)[0] as HTMLIFrameElement | undefined;
      const ready = p.role === 'driver' ? tid('driver-status') : tid('where-to');
      expect(body?.contentDocument?.querySelector(ready), `${p.id} rendered`).to.exist;
    }
  });
  for (const p of phones) {
    if (p.role === 'driver') cy.phone(p.id).find(tid('driver-status')).should('have.text', 'Online');
  }
  cy.waitForDispatch(
    (state) => phones.every((p) => state.devices.some((d) => d.id === p.id && d.online)),
    'all phones connected',
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

Cypress.Commands.add('bid', (driverId, amount, options = {}) => {
  offerOn(driverId, options.rider).find(tid('bid-input')).clear().type(amount.toFixed(2), { delay: typeDelayMs() });
  offerOn(driverId, options.rider).find(tid('submit-bid')).click();
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
