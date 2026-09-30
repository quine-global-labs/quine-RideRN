import { defineScenario, tid } from '../support/e2e';
import { alice, bob, carol, james, maria } from '../support/phones';

export default defineScenario('lets a driver queue one ride behind the current one, and no more', () => {
  cy.resetDispatch();
  cy.openPhones([alice, bob, carol, maria, james]);

  cy.requestRide('alice', 'ferry', 'Ferry Building');
  cy.requestRide('bob', 'ferry', 'Ferry Building');
  cy.phone('maria').find(tid('offer')).should('have.length', 2);

  // Maria takes Bob's ride, and is still offered Alice's as her next one.
  cy.accept('maria', { rider: 'Bob' });
  cy.phone('maria').find(tid('nav-heading')).should('have.text', 'Pick up Bob');
  cy.phone('maria').find(tid('offer')).should('have.length', 1);
  cy.accept('maria', { rider: 'Alice' });
  cy.phone('maria').find(tid('next-job')).should('contain.text', 'Next: Alice');
  cy.phone('alice').find(tid('driver-finishing')).should('contain.text', 'Maria is finishing a nearby trip');
  cy.phone('bob').find(tid('driver-finishing')).should('not.exist');

  // With a ride in progress and one queued, Maria is full: Carol's request skips her.
  cy.requestRide('carol', 'ferry', 'Ferry Building');
  cy.phone('james').find(tid('offer-destination')).should('have.text', 'Carol → Ferry Building');
  cy.phone('maria').find(tid('offer-sheet')).should('not.exist');
  cy.waitForDispatch((s) => s.rides.length === 3, 'three requests').then(({ rides, devices }) => {
    expect(rides[2].rounds[0].invited).to.deep.equal(['james']);
    expect(devices.find((d) => d.id === 'maria')?.jobs).to.deep.equal(['ride-2', 'ride-1']);
  });

  // Finishing Bob's trip makes room again, so Maria joins Carol's open round.
  cy.phone('maria').find(tid('complete-trip')).click();
  cy.phone('maria').find(tid('nav-heading')).should('have.text', 'Pick up Alice');
  cy.phone('maria').find(tid('offer-destination')).should('have.text', 'Carol → Ferry Building');
});
