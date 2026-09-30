import { defineScenario, tid } from '../support/e2e';
import { alice, james, maria } from '../support/phones';

export default defineScenario('only offers rides to drivers in driving mode', () => {
  cy.resetDispatch();
  cy.openPhones([alice, { ...maria, driving: false }, james]);

  cy.phone('maria').find(tid('driver-offline')).should('contain.text', 'You’re offline');
  cy.phone('james').find(tid('driver-waiting')).should('contain.text', 'Looking for ride requests');

  cy.requestRide('alice', 'ferry', 'Ferry Building');

  // Only James is driving, so only James is asked.
  cy.phone('james').find(tid('offer-sheet')).should('exist');
  cy.phone('maria').find(tid('offer-sheet')).should('not.exist');
  cy.dispatchState().then(({ rides }) => expect(rides[0].rounds[0].invited).to.deep.equal(['james']));

  // Maria starts driving mid-round and is offered the open round straight away.
  cy.startDriving('maria');
  cy.phone('maria').find(tid('offer-price')).should('have.text', '$8.80');

  // James goes offline: his request disappears and he's no longer counted.
  cy.goOffline('james');
  cy.phone('james').find(tid('offer-sheet')).should('not.exist');
  cy.phone('james').find(tid('driver-offline')).should('exist');

  // With James gone, Maria passing is everyone passing: round 2 goes to Maria alone.
  cy.pass('maria');
  cy.phone('maria').find(tid('offer-price')).should('have.text', '$9.35');
  cy.phone('james').find(tid('offer-sheet')).should('not.exist');
  cy.waitForDispatch((s) => s.rides[0]?.rounds.length === 2, 'round 2 open').then(({ rides }) => {
    expect(rides[0].rounds[0].invited).to.deep.equal(['james', 'maria']);
    expect(rides[0].rounds[1].invited).to.deep.equal(['maria']);
  });
});
