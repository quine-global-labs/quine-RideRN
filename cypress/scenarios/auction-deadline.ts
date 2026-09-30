import { defineScenario, tid } from '../support/e2e';
import { scaled } from '../support/pace';
import { alice, maria, james } from '../support/phones';

export default defineScenario('closes on the deadline and awards whoever did bid', () => {
  cy.resetDispatch({ auctionDurationMs: scaled(4000) });
  cy.openPhones([alice, maria, james]);
  cy.requestRide('alice', 'ferry', 'Ferry Building');

  cy.bid('maria', 10.75);
  // James never answers; the auction stays open until the window runs out.
  cy.phone('alice').find(tid('ride-status')).should('have.text', 'Finding your driver');

  cy.phone('alice').find(tid('ride-status'), { timeout: scaled(8000) }).should('have.text', 'Driver found');
  cy.phone('alice').find(tid('ride-fare')).should('have.text', '$10.75');
  cy.phone('james').find(tid('driver-result')).should('have.text', 'That request closed before you answered');
  cy.phone('james').find(tid('offer')).should('not.exist');
});
