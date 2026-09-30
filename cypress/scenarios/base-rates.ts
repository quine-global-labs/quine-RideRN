import { defineScenario, tid } from '../support/e2e';
import { alice, maria } from '../support/phones';

export default defineScenario('quotes from San Francisco rate cards and pays drivers their share', () => {
  cy.resetDispatch({ rates: 'real' });
  cy.openPhones([alice, maria]);

  // The fixture trip is 5 km (3.11 mi) and 10 min. UberX in SF:
  // $2.50 base + 3.11 mi × $1.55 + 10 min × $0.32 + $3.00 booking fee = $13.52.
  cy.phone('alice').find(tid('where-to')).click();
  cy.phone('alice').find(tid('destination-input')).type('ferry');
  cy.phone('alice').contains('Ferry Building').click();
  cy.phone('alice').find(tid('price-x')).should('have.text', '$13.52');
  cy.phone('alice').find(tid('price-comfort')).should('have.text', '$15.55');
  cy.phone('alice').find(tid('price-xl')).should('have.text', '$16.52');
  cy.phone('alice').find(tid('price-black')).should('have.text', '$28.65');
  cy.phone('alice').find(tid('surge-notice')).should('not.exist');

  cy.phone('alice').find(tid('confirm-ride')).click();

  // Round 1 offers 80% of the quote; Maria sees what she'd earn: 75% of what Alice pays.
  cy.phone('maria').find(tid('offer-price')).should('have.text', '$10.82');
  cy.phone('maria').find(tid('offer-earnings')).should('have.text', '$8.12');
  cy.accept('maria');
  cy.phone('maria').find(tid('job-earnings')).should('have.text', 'You earn $8.12');
  cy.phone('alice').find(tid('ride-fare')).should('have.text', '$10.82');

  cy.dispatchState().then(({ rides, pricing }) => {
    expect(pricing.driverShare).to.equal(0.75);
    expect(rides[0]).to.include({ rideTypeId: 'x', quotedFare: 13.52, surge: 1, fare: 10.82 });
  });
});
