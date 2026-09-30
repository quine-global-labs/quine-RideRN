import { defineScenario, tid } from '../support/e2e';
import { scaled } from '../support/pace';
import { alice, bob, james, maria } from '../support/phones';

export default defineScenario('interrupts a waiting driver, and a driver mid-ride, with a request', () => {
  cy.resetDispatch();
  cy.openPhones([alice, bob, maria, james]);

  // Both drivers are driving with nothing to do yet.
  for (const driver of ['maria', 'james']) {
    cy.phone(driver).find(tid('driver-waiting')).should('exist');
    cy.phone(driver).find(tid('offer-sheet')).should('not.exist');
  }

  // A request interrupts the waiting screen; passing goes back to waiting.
  cy.requestRide('alice', 'ferry', 'Ferry Building');
  cy.phone('maria').find(tid('offer-sheet')).should('contain.text', 'New ride request');
  cy.pass('maria');
  cy.phone('maria').find(tid('offer-sheet')).should('not.exist');
  cy.phone('maria').find(tid('driver-waiting')).should('exist');

  // James takes Alice's ride and starts navigating to her.
  cy.accept('james');
  cy.phone('james').find(tid('driver-waiting')).should('not.exist');
  cy.phone('james').find(tid('nav-heading')).should('have.text', 'Pick up Alice');

  // Hold on to James's navigation view, to prove the next request never replaces it.
  let navigation: HTMLElement;
  cy.phone('james')
    .find(tid('driver-navigation'))
    .then(([el]) => {
      navigation = el;
    });

  // Mid-ride, Bob's request pops up over the directions.
  cy.requestRide('bob', 'ferry', 'Ferry Building');
  cy.phone('james').find(tid('offer-sheet')).should('contain.text', 'Accepting makes this your next ride, after Alice.');
  cy.phone('james').find(tid('driver-navigation')).should('exist');

  // The directions keep going underneath while James decides.
  cy.phone('james')
    .find(tid('nav-instruction'))
    .invoke('text')
    .then((before) => {
      cy.phone('james').find(tid('nav-instruction'), { timeout: scaled(8000) }).should('not.have.text', before);
    });

  // Accepting queues Bob behind Alice; the navigation to Alice carries on untouched.
  cy.pass('maria');
  cy.accept('james');
  cy.phone('james').find(tid('offer-sheet')).should('not.exist');
  cy.phone('james').find(tid('next-job')).should('have.text', 'Next: Bob → Ferry Building · $8.80');
  cy.phone('james')
    .find(tid('driver-navigation'))
    .should(([el]) => expect(el, 'navigation was never remounted').to.equal(navigation));
  cy.phone('james').find(tid('nav-heading')).should('have.text', 'Pick up Alice');
  cy.phone('bob').find(tid('driver-finishing')).should('have.text', 'James is finishing a nearby trip, then heading to you');

  // Finishing Alice's trip moves James on to Bob.
  cy.phone('james').find(tid('complete-trip')).click();
  cy.phone('alice').find(tid('ride-status')).should('have.text', 'You’ve arrived');
  cy.phone('james').find(tid('nav-heading')).should('have.text', 'Pick up Bob');
  cy.phone('james').find(tid('next-job')).should('not.exist');
  cy.phone('bob').find(tid('driver-finishing')).should('not.exist');
});
