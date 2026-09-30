import { defineScenario, tid } from '../support/e2e';
import { alice, bob, james, maria } from '../support/phones';

export default defineScenario('never gives one driver two rides at once', () => {
  cy.resetDispatch();
  cy.openPhones([alice, bob, maria, james]);

  cy.requestRide('alice', 'ferry', 'Ferry Building');
  cy.requestRide('bob', 'ferry', 'Ferry Building');
  cy.phone('maria').find(tid('offer')).should('have.length', 2);

  // Maria takes Bob's ride, so Alice's offer disappears from her phone.
  cy.accept('maria', { rider: 'Bob' });
  cy.phone('bob').find(tid('driver-name')).should('contain.text', 'Maria');
  cy.phone('maria').find(tid('driver-job')).should('contain.text', 'Bob');
  cy.phone('maria').find(tid('offer')).should('not.exist');

  // Alice's round now only waits on James. When he passes, the next round skips Maria.
  cy.pass('james', { rider: 'Alice' });
  cy.phone('james').find(tid('offer-price')).should('have.text', '$9.35');
  cy.accept('james', { rider: 'Alice' });

  cy.phone('alice').find(tid('driver-name')).should('contain.text', 'James');
  cy.phone('alice').find(tid('ride-fare')).should('have.text', '$9.35');
  cy.waitForDispatch((s) => s.rides.every((r) => r.status === 'matched'), 'both rides matched').then(({ rides }) => {
    expect(rides.map((r) => [r.riderId, r.winnerId])).to.deep.equal([
      ['alice', 'james'],
      ['bob', 'maria'],
    ]);
    expect(rides[0].rounds[1].invited).to.deep.equal(['james']);
  });
});
