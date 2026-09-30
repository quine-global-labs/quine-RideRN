import { defineScenario, tid } from '../support/e2e';
import { aisha, alice, james, maria } from '../support/phones';

export default defineScenario('gives the ride to the first driver who accepts, and runs the trip', () => {
  cy.resetDispatch();
  cy.openPhones([alice, maria, james, aisha]);

  cy.requestRide('alice', 'ferry', 'Ferry Building');

  // Every driver is offered the same suggested fare: 80% of the $11.00 quote.
  for (const driver of ['maria', 'james', 'aisha']) {
    cy.phone(driver).find(tid('offer-destination')).should('have.text', 'Alice → Ferry Building');
    cy.phone(driver).find(tid('offer-price')).should('have.text', '$8.80');
    cy.phone(driver).find(tid('offer-round')).should('contain.text', 'round 1');
  }
  cy.phone('alice').find(tid('round-price')).should('have.text', 'Offering drivers $8.80');
  cy.phone('alice').find(tid('round-number')).should('have.text', 'Round 1');

  cy.pass('maria');
  cy.phone('maria').find(tid('offer-passed')).should('contain.text', 'You passed at $8.80');

  // James takes it straight away; Aisha never gets to answer.
  cy.accept('james');

  cy.phone('alice').find(tid('ride-status')).should('have.text', 'Driver found');
  cy.phone('alice').find(tid('ride-fare')).should('have.text', '$8.80');
  cy.phone('alice').find(tid('fare-vs-quote')).should('have.text', '$2.20 below your quote');
  cy.phone('alice').find(tid('driver-name')).should('contain.text', 'James');
  cy.phone('alice').find(tid('matched-driver')).should('contain.text', '8TRW115');

  cy.phone('james').find(tid('job-fare')).should('have.text', 'Fare $8.80');
  cy.phone('aisha').find(tid('driver-result')).should('have.text', 'Another driver took that ride');
  cy.phone('maria').find(tid('offer-sheet')).should('not.exist');
  cy.phone('maria').find(tid('driver-waiting')).should('exist');
  cy.phone('maria').find(tid('driver-result')).should('not.exist');

  cy.dispatchState().then(({ rides }) => {
    expect(rides).to.have.length(1);
    expect(rides[0]).to.include({ status: 'matched', winnerId: 'james', fare: 8.8 });
    expect(rides[0].rounds).to.have.length(1);
    expect(rides[0].rounds[0]).to.include({ price: 8.8, acceptedBy: 'james' });
    expect(rides[0].rounds[0].declined).to.deep.equal(['maria']);
  });

  // The driver finishes the trip; the rider's phone follows.
  cy.phone('james').find(tid('complete-trip')).click();
  cy.phone('james').find(tid('driver-result')).should('have.text', 'Trip complete · you earned $6.60');
  cy.phone('alice').find(tid('ride-status')).should('have.text', 'You’ve arrived');
  cy.phone('alice').should('contain.text', 'Thanks for riding with James.');

  cy.phone('alice').find(tid('trip-done')).click();
  cy.phone('alice').find(tid('where-to')).should('exist');
});
