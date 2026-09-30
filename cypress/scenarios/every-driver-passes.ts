import { defineScenario, tid } from '../support/e2e';
import { alice, maria, james } from '../support/phones';

export default defineScenario('tells the rider when every driver passes', () => {
  cy.resetDispatch();
  cy.openPhones([alice, maria, james]);
  cy.requestRide('alice', 'ferry', 'Ferry Building');

  cy.pass('maria');
  cy.pass('james');

  cy.phone('alice').find(tid('ride-status')).should('have.text', 'No drivers available');
  cy.waitForDispatch((s) => s.rides[0]?.status === 'unmatched', 'ride unmatched');

  // Going back lets the rider try again with a fresh auction.
  cy.phone('alice').find(tid('unmatched-back')).click();
  cy.phone('alice').find(tid('confirm-ride')).click();
  cy.phone('maria').find(tid('offer')).should('have.length', 1);
  cy.waitForDispatch((s) => s.rides.length === 2 && s.rides[1].status === 'auction', 'second auction open');
});
