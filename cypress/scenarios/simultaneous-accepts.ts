import { defineScenario, tid } from '../support/e2e';
import { alice, james, maria } from '../support/phones';

export default defineScenario('settles two drivers accepting at once by who reached dispatch first', () => {
  cy.resetDispatch();
  cy.openPhones([alice, maria, james]);
  cy.requestRide('alice', 'ferry', 'Ferry Building');
  cy.phone('maria').find(tid('offer-price')).should('have.text', '$8.80');
  cy.phone('james').find(tid('offer-price')).should('have.text', '$8.80');

  // Cut both drivers off from dispatch, so each still thinks the ride is up for grabs.
  cy.pausePhone('maria');
  cy.pausePhone('james');

  // Maria taps first, then James. Neither tap has reached dispatch yet.
  cy.accept('maria');
  cy.accept('james');
  cy.phone('maria').find(tid('offer')).should('exist');
  cy.phone('james').find(tid('offer')).should('exist');
  cy.dispatchState().then(({ rides }) => expect(rides[0].status).to.equal('auction'));

  // James's accept arrives first, so James wins, even though Maria tapped first.
  cy.resumePhone('james');
  cy.phone('alice').find(tid('driver-name')).should('contain.text', 'James');
  cy.phone('james').find(tid('job-fare')).should('have.text', 'Fare $8.80');

  // Maria's accept arrives second and is turned down.
  cy.resumePhone('maria');
  cy.phone('maria').find(tid('driver-error')).should('have.text', 'Another driver already took this ride');
  cy.phone('maria').find(tid('driver-result')).should('have.text', 'Another driver took that ride');
  cy.phone('maria').find(tid('offer')).should('not.exist');
  cy.phone('maria').find(tid('driver-job')).should('not.exist');

  cy.waitForDispatch((s) => s.rides[0]?.rounds[0].lateAccepts.length === 1, 'late accept recorded').then(({ rides }) => {
    expect(rides).to.have.length(1);
    expect(rides[0]).to.include({ status: 'matched', winnerId: 'james', fare: 8.8 });
    expect(rides[0].rounds[0]).to.include({ acceptedBy: 'james' });
    expect(rides[0].rounds[0].lateAccepts).to.deep.equal(['maria']);
  });
});
