import { defineScenario, tid } from '../support/e2e';
import { alice, maria } from '../support/phones';

const downtownFairbanks = { latitude: 64.8378, longitude: -147.7164 };

export default defineScenario('prices rides in Fairbanks from Fairbanks rate cards', () => {
  cy.intercept('GET', /photon\.komoot\.io\/api/, { fixture: 'photon-pioneer-park.json' });
  cy.resetDispatch({ rates: 'real' });
  cy.openPhones([
    { ...alice, location: downtownFairbanks },
    { ...maria, location: downtownFairbanks },
  ]);

  // Same 5 km, 10 min fixture trip, Fairbanks UberX: $2.77 + 3.11 mi × $1.86 + 10 min × $0.31
  // + $2.55 booking fee = $14.20. Comfort uses Anchorage's rates; no Black in Fairbanks.
  cy.phone('alice').find(tid('where-to')).click();
  cy.phone('alice').find(tid('destination-input')).type('pioneer');
  cy.phone('alice').contains('Pioneer Park').click();
  cy.phone('alice').find(tid('price-x')).should('have.text', '$14.20');
  cy.phone('alice').find(tid('price-comfort')).should('have.text', '$17.29');
  cy.phone('alice').find(tid('price-xl')).should('have.text', '$16.39');
  cy.phone('alice').find(tid('price-black')).should('not.exist');
  cy.phone('alice').find(tid('confirm-ride')).click();
  cy.phone('alice').find(tid('ride-status')).should('have.text', 'Finding your driver');

  cy.phone('maria').find(tid('offer-destination')).should('have.text', 'Alice → Pioneer Park');
  cy.phone('maria').find(tid('offer-price')).should('have.text', '$11.36');
  cy.phone('maria').find(tid('offer-earnings')).should('have.text', '$8.52');

  cy.waitForDispatch((s) => s.rides.length === 1, 'ride requested').then(({ rides }) => {
    expect(rides[0]).to.include({ rideTypeId: 'x', quotedFare: 14.2 });
    expect(rides[0].pickup).to.deep.equal(downtownFairbanks);
  });
});
