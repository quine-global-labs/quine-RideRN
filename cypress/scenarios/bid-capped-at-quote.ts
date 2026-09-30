import { defineScenario, tid } from '../support/e2e';
import { alice, maria } from '../support/phones';

export default defineScenario('does not let a driver bid above the quoted fare', () => {
  cy.resetDispatch();
  cy.openPhones([alice, maria]);
  cy.requestRide('alice', 'ferry', 'Ferry Building');

  cy.phone('maria').find(tid('bid-input')).clear().type('11.01');
  cy.phone('maria').find(tid('submit-bid')).should('have.attr', 'aria-disabled', 'true');

  cy.phone('maria').find(tid('bid-input')).clear().type('11');
  cy.phone('maria').find(tid('submit-bid')).should('not.have.attr', 'aria-disabled');
});
