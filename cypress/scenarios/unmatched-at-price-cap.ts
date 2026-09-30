import { defineScenario, tid } from '../support/e2e';
import { alice, james, maria } from '../support/phones';

export default defineScenario('gives up once nobody takes the capped price', () => {
  // 90% of the quote, then 100%, which is the cap: two rounds, $9.90 and $11.00.
  cy.resetDispatch({ policy: { startMultiplier: 0.9, stepMultiplier: 0.1, maxMultiplier: 1 } });
  cy.openPhones([alice, maria, james]);
  cy.requestRide('alice', 'ferry', 'Ferry Building');

  cy.pass('maria');
  cy.pass('james');
  cy.phone('maria').find(tid('offer-price')).should('have.text', '$11.00');
  cy.pass('maria');
  cy.pass('james');

  cy.phone('alice').find(tid('ride-status')).should('have.text', 'No drivers available');
  cy.phone('alice').should('contain.text', 'even at $11.00');
  cy.phone('maria').find(tid('offer')).should('not.exist');
  cy.waitForDispatch((s) => s.rides[0]?.status === 'unmatched', 'ride unmatched').then(({ rides }) => {
    expect(rides[0].rounds.map((r) => [r.price, r.final])).to.deep.equal([
      [9.9, false],
      [11, true],
    ]);
  });

  // Going back lets the rider try again, starting from round 1.
  cy.phone('alice').find(tid('unmatched-back')).click();
  cy.phone('alice').find(tid('confirm-ride')).click();
  cy.phone('maria').find(tid('offer-price')).should('have.text', '$9.90');
  cy.waitForDispatch((s) => s.rides.length === 2 && s.rides[1].status === 'auction', 'second request open');
});
