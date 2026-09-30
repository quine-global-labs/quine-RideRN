import { defineScenario, tid } from '../support/e2e';
import { alice, bob, maria, james } from '../support/phones';

export default defineScenario('never gives one driver two rides at once', () => {
  cy.resetDispatch();
  cy.openPhones([alice, bob, maria, james]);

  cy.requestRide('alice', 'ferry', 'Ferry Building');
  cy.requestRide('bob', 'ferry', 'Ferry Building');
  cy.phone('maria').find(tid('offer')).should('have.length', 2);

  // Maria is the cheapest on both rides.
  cy.bid('maria', 7, { rider: 'Alice' });
  cy.bid('maria', 6, { rider: 'Bob' });
  cy.bid('james', 9, { rider: 'Bob' });

  // Bob's auction has every answer, so it closes first and Maria wins it.
  cy.phone('bob').find(tid('driver-name')).should('contain.text', 'Maria');
  cy.phone('bob').find(tid('ride-fare')).should('have.text', '$6.00');

  // Alice's auction is still waiting on James. Maria's lower bid no longer counts.
  cy.phone('alice').find(tid('ride-status')).should('have.text', 'Finding your driver');
  cy.bid('james', 10, { rider: 'Alice' });

  cy.phone('alice').find(tid('driver-name')).should('contain.text', 'James');
  cy.phone('alice').find(tid('ride-fare')).should('have.text', '$10.00');
  cy.waitForDispatch((s) => s.rides.every((r) => r.status === 'matched'), 'both rides matched').then(({ rides }) => {
    expect(rides.map((r) => [r.riderId, r.winnerId])).to.deep.equal([
      ['alice', 'james'],
      ['bob', 'maria'],
    ]);
  });
});
