import { defineScenario, tid } from '../support/e2e';
import { alice, maria } from '../support/phones';

export default defineScenario('follows the configured pricing, including above the quote', () => {
  // Start at 120% of the quote, add 10% a round, no cap.
  cy.resetDispatch({ startMultiplier: 1.2, stepMultiplier: 0.1, maxMultiplier: null });
  cy.openPhones([alice, maria]);
  cy.requestRide('alice', 'ferry', 'Ferry Building');

  cy.phone('maria').find(tid('offer-price')).should('have.text', '$13.20');
  cy.pass('maria');
  cy.phone('maria').find(tid('offer-price')).should('have.text', '$14.30');
  cy.accept('maria');

  cy.phone('alice').find(tid('ride-fare')).should('have.text', '$14.30');
  cy.phone('alice').find(tid('fare-vs-quote')).should('have.text', '$3.30 above your quote');
  cy.dispatchState().then(({ policy, rides }) => {
    expect(policy).to.include({ startMultiplier: 1.2, stepMultiplier: 0.1, maxMultiplier: null });
    expect(rides[0].rounds.map((r) => r.final)).to.deep.equal([false, false]);
  });
});
