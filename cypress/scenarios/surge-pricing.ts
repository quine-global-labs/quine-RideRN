import { defineScenario, tid } from '../support/e2e';
import { alice, bob, carol, james, maria } from '../support/phones';

const oakland = { latitude: 37.8044, longitude: -122.2712 };
const downtown = { latitude: 37.7749, longitude: -122.4194 };

/** Rider searches for the Ferry Building and picks it, which gets them a fresh quote. */
function pickFerryBuilding(riderId: string) {
  cy.phone(riderId).find(tid('where-to')).click();
  cy.phone(riderId).find(tid('destination-input')).type('ferry');
  cy.phone(riderId).contains('Ferry Building').click();
}

export default defineScenario('surges prices in a zone where requests outnumber drivers', () => {
  // Surge on and recomputed on every quote, so each step sees the latest demand and supply.
  cy.resetDispatch({ pricing: { surge: { enabled: true, intervalMs: 0 } } });
  cy.openPhones([
    alice,
    bob,
    carol,
    { role: 'rider', id: 'dave', name: 'Dave', location: oakland },
    maria,
    { ...james, driving: false },
  ]);
  cy.waitForDispatch((s) => s.devices.some((d) => d.id === 'maria' && d.position !== null), 'Maria reported her position').then(
    ({ devices }) => expect(devices.find((d) => d.id === 'maria')?.position).to.deep.equal(downtown),
  );

  // One driver downtown. Alice and then Bob are each quoted before their own request
  // counts, so neither sees more requests than drivers: no surge.
  cy.requestRide('alice', 'ferry', 'Ferry Building');
  cy.requestRide('bob', 'ferry', 'Ferry Building');

  // Now two requests for one driver in the zone: 1 + (2 − 1) × 0.5 = 1.5×.
  pickFerryBuilding('carol');
  cy.phone('carol').find(tid('surge-notice')).should('have.text', 'Busy area · prices are 1.5× higher right now');
  cy.phone('carol').find(tid('price-x')).should('have.text', '$16.50');

  // Dave is across the bay, in a zone with no demand: no surge.
  pickFerryBuilding('dave');
  cy.phone('dave').find(tid('price-x')).should('have.text', '$11.00');
  cy.phone('dave').find(tid('surge-notice')).should('not.exist');

  // More supply: James starts driving downtown, so two requests for two drivers.
  cy.startDriving('james');
  cy.phone('carol').find(tid('clear-destination')).click();
  pickFerryBuilding('carol');
  cy.phone('carol').find(tid('price-x')).should('have.text', '$11.00');
  cy.phone('carol').find(tid('surge-notice')).should('not.exist');

  // James goes offline again, and the surge comes back.
  cy.goOffline('james');
  cy.phone('carol').find(tid('clear-destination')).click();
  pickFerryBuilding('carol');
  cy.phone('carol').find(tid('price-x')).should('have.text', '$16.50');

  // Carol books at her surged quote; the auction starts from it (80% of $16.50).
  cy.phone('carol').find(tid('confirm-ride')).click();
  cy.phone('maria').find(tid('offer')).filter(':contains("Carol →")').find(tid('offer-price')).should('have.text', '$13.20');
  cy.waitForDispatch((s) => s.rides.length === 3, 'Carol requested').then(({ rides }) => {
    expect(rides.map((r) => [r.riderId, r.surge, r.quotedFare])).to.deep.equal([
      ['alice', 1, 11],
      ['bob', 1, 11],
      ['carol', 1.5, 16.5],
    ]);
  });
});
