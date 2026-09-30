import { defineScenario, tid } from '../support/e2e';
import { alice, james, maria } from '../support/phones';

export default defineScenario('raises the price when every driver passes', () => {
  cy.resetDispatch();
  cy.openPhones([alice, maria, james]);
  cy.requestRide('alice', 'ferry', 'Ferry Building');

  cy.pass('maria');
  // Maria waits on James before anything changes.
  cy.phone('maria').find(tid('offer-passed')).should('exist');
  cy.pass('james');

  // Nobody took $8.80, so a new round offers everyone 5% of the quote more.
  for (const driver of ['maria', 'james']) {
    cy.phone(driver).find(tid('offer-price')).should('have.text', '$9.35');
    cy.phone(driver).find(tid('offer-round')).should('contain.text', 'round 2');
    cy.phone(driver).find(tid('accept-offer')).should('exist');
  }
  cy.phone('alice').find(tid('round-price')).should('have.text', 'Offering drivers $9.35');
  cy.phone('alice').find(tid('round-number')).should('have.text', 'Round 2');

  cy.accept('maria');
  cy.phone('alice').find(tid('ride-fare')).should('have.text', '$9.35');
  cy.phone('alice').find(tid('driver-name')).should('contain.text', 'Maria');

  cy.dispatchState().then(({ rides }) => {
    expect(rides[0].rounds.map((r) => [r.price, r.acceptedBy])).to.deep.equal([
      [8.8, null],
      [9.35, 'maria'],
    ]);
    expect(rides[0].rounds[0].declined).to.have.members(['maria', 'james']);
  });
});
