import { defineScenario, tid } from '../support/e2e';
import { scaled } from '../support/pace';
import { alice, james, maria } from '../support/phones';

export default defineScenario('raises the price when a round runs out of time', () => {
  cy.resetDispatch({ policy: { roundDurationMs: 3000 } });
  cy.openPhones([alice, maria, james]);
  cy.requestRide('alice', 'ferry', 'Ferry Building');

  // Maria passes but James never answers, so round 1 lasts its full 3 s.
  cy.pass('maria');
  cy.phone('alice').find(tid('round-number')).should('have.text', 'Round 1');

  cy.phone('alice').find(tid('round-number'), { timeout: scaled(8000) }).should('have.text', 'Round 2');
  cy.phone('james').find(tid('offer-price')).should('have.text', '$9.35');
  cy.accept('james');

  cy.phone('alice').find(tid('ride-fare')).should('have.text', '$9.35');
  cy.dispatchState().then(({ rides }) => {
    expect(rides[0].rounds[0]).to.include({ price: 8.8, acceptedBy: null });
    expect(rides[0].rounds[0].declined).to.deep.equal(['maria']);
  });
});
