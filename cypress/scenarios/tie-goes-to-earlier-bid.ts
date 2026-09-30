import { defineScenario, tid } from '../support/e2e';
import { alice, maria, james } from '../support/phones';

export default defineScenario('breaks a tie in favour of the earlier bid', () => {
  cy.resetDispatch();
  cy.openPhones([alice, maria, james]);
  cy.requestRide('alice', 'ferry', 'Ferry Building');

  cy.bid('james', 9);
  cy.phone('james').find(tid('offer-my-bid')).should('exist');
  cy.bid('maria', 9);

  cy.phone('alice').find(tid('driver-name')).should('contain.text', 'James');
  cy.phone('maria').find(tid('driver-result')).should('have.text', 'Another driver won that ride');
});
