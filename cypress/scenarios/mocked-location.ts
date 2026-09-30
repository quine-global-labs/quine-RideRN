import { defineScenario, tid } from '../support/e2e';
import { alice, maria } from '../support/phones';

const unionSquare = { latitude: 37.788, longitude: -122.4075 };

export default defineScenario('uses each phone’s mocked location instead of real GPS', () => {
  cy.intercept('GET', /photon\.komoot\.io\/api/, { fixture: 'photon-ferry-building.json' }).as('search');
  cy.intercept('GET', /router\.project-osrm\.org\/route/, { fixture: 'osrm-5km.json' }).as('route');

  cy.resetDispatch();
  cy.openPhones([{ ...alice, location: unionSquare }, maria]);

  // No location prompt to answer and no "Location is off" fallback: the phone just knows.
  cy.phone('alice').find(tid('where-to')).should('exist');
  cy.phone('alice').should('not.contain.text', 'Location is off');

  cy.requestRide('alice', 'ferry', 'Ferry Building');

  // Search is biased toward, and the route starts from, Union Square.
  cy.wait('@search').its('request.url').should('contain', 'lat=37.788').and('contain', 'lon=-122.4075');
  cy.wait('@route').its('request.url').should('contain', '/driving/-122.4075,37.788;');
  cy.waitForDispatch((s) => s.rides.length === 1, 'ride requested').then(({ rides }) => {
    expect(rides[0].pickup).to.deep.equal(unionSquare);
  });
});
