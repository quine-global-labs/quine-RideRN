import { defineScenario, tid } from '../support/e2e';
import { alice, james, maria } from '../support/phones';

export default defineScenario('withdraws the offer from every driver when the rider cancels', () => {
  cy.resetDispatch();
  cy.openPhones([alice, maria, james]);
  cy.requestRide('alice', 'ferry', 'Ferry Building');

  cy.pass('maria');
  cy.phone('alice').find(tid('cancel-request')).click();
  cy.phone('alice').find(tid('confirm-ride')).should('exist');

  for (const driver of ['maria', 'james']) {
    cy.phone(driver).find(tid('offer')).should('not.exist');
    cy.phone(driver).find(tid('driver-result')).should('have.text', 'The rider cancelled their request');
  }
  cy.waitForDispatch((s) => s.rides[0]?.status === 'cancelled', 'ride cancelled');
});
