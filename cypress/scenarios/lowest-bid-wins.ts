import { defineScenario, tid } from '../support/e2e';
import { alice, maria, james, aisha } from '../support/phones';

export default defineScenario('awards the ride to the lowest bid and runs the trip end to end', () => {
  cy.resetDispatch();
  cy.openPhones([alice, maria, james, aisha]);

  cy.requestRide('alice', 'ferry', 'Ferry Building');

  // Every driver is invited, capped at the quoted fare.
  for (const driver of ['maria', 'james', 'aisha']) {
    cy.phone(driver).find(tid('offer-destination')).should('have.text', 'Alice → Ferry Building');
    cy.phone(driver).find(tid('offer-max-fare')).should('have.text', 'Rider pays up to $11.00');
  }

  cy.bid('maria', 10);
  cy.phone('maria').find(tid('offer-my-bid')).should('contain.text', 'You bid $10.00');
  cy.phone('alice').find(tid('offer-count')).should('have.text', '1 offer so far');

  cy.bid('james', 8.5);
  cy.phone('alice').find(tid('offer-count')).should('have.text', '2 offers so far');

  // The last driver answering closes the auction without waiting out the clock.
  cy.pass('aisha');

  cy.phone('alice').find(tid('ride-status')).should('have.text', 'Driver found');
  cy.phone('alice').find(tid('ride-fare')).should('have.text', '$8.50');
  cy.phone('alice').find(tid('driver-name')).should('contain.text', 'James');
  cy.phone('alice').find(tid('matched-driver')).should('contain.text', '8TRW115');

  cy.phone('james').find(tid('job-fare')).should('have.text', 'Fare $8.50');
  cy.phone('maria').find(tid('driver-result')).should('have.text', 'Another driver won that ride');
  cy.phone('aisha').find(tid('driver-idle')).should('exist');
  cy.phone('aisha').find(tid('driver-result')).should('not.exist');

  cy.dispatchState().then(({ rides }) => {
    expect(rides).to.have.length(1);
    expect(rides[0]).to.include({ status: 'matched', winnerId: 'james', fare: 8.5, maxFare: 11 });
    expect(rides[0].declined).to.deep.equal(['aisha']);
  });

  // The winning driver finishes the trip; the rider's phone follows.
  cy.phone('james').find(tid('complete-trip')).click();
  cy.phone('james').find(tid('driver-result')).should('have.text', 'Trip complete · you earned $8.50');
  cy.phone('alice').find(tid('ride-status')).should('have.text', 'You’ve arrived');
  cy.phone('alice').should('contain.text', 'Thanks for riding with James.');

  cy.phone('alice').find(tid('trip-done')).click();
  cy.phone('alice').find(tid('where-to')).should('exist');
});
