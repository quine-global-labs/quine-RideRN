import { tid, type PhoneSpec } from '../support/e2e';

// Multi-phone scenarios for the ride price auction. When a rider requests a ride, every
// online, idle driver gets a sealed-bid invitation capped at the rider's quoted fare.
// The lowest bid wins; the auction closes once every driver has answered or time runs out.
//
// The fixtures make every trip 5 km / 10 min, so UberX is quoted at $11.00.

const alice: PhoneSpec = { role: 'rider', id: 'alice', name: 'Alice' };
const bob: PhoneSpec = { role: 'rider', id: 'bob', name: 'Bob' };
const maria: PhoneSpec = { role: 'driver', id: 'maria', name: 'Maria', car: 'Toyota Camry · Silver', plate: '7KDL294', rating: 4.95 };
const james: PhoneSpec = { role: 'driver', id: 'james', name: 'James', car: 'Honda Accord · Black', plate: '8TRW115', rating: 4.88 };
const aisha: PhoneSpec = { role: 'driver', id: 'aisha', name: 'Aisha', car: 'Tesla Model 3 · White', plate: '9EVA662', rating: 4.97 };

describe('ride price auction', () => {
  it('awards the ride to the lowest bid and runs the trip end to end', () => {
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

  it('breaks a tie in favour of the earlier bid', () => {
    cy.resetDispatch();
    cy.openPhones([alice, maria, james]);
    cy.requestRide('alice', 'ferry', 'Ferry Building');

    cy.bid('james', 9);
    cy.phone('james').find(tid('offer-my-bid')).should('exist');
    cy.bid('maria', 9);

    cy.phone('alice').find(tid('driver-name')).should('contain.text', 'James');
    cy.phone('maria').find(tid('driver-result')).should('have.text', 'Another driver won that ride');
  });

  it('does not let a driver bid above the quoted fare', () => {
    cy.resetDispatch();
    cy.openPhones([alice, maria]);
    cy.requestRide('alice', 'ferry', 'Ferry Building');

    cy.phone('maria').find(tid('bid-input')).clear().type('11.01');
    cy.phone('maria').find(tid('submit-bid')).should('have.attr', 'aria-disabled', 'true');

    cy.phone('maria').find(tid('bid-input')).clear().type('11');
    cy.phone('maria').find(tid('submit-bid')).should('not.have.attr', 'aria-disabled');
  });

  it('closes on the deadline and awards whoever did bid', () => {
    cy.resetDispatch({ auctionDurationMs: 4000 });
    cy.openPhones([alice, maria, james]);
    cy.requestRide('alice', 'ferry', 'Ferry Building');

    cy.bid('maria', 10.75);
    // James never answers; the auction stays open until the window runs out.
    cy.phone('alice').find(tid('ride-status')).should('have.text', 'Finding your driver');

    cy.phone('alice').find(tid('ride-status'), { timeout: 8000 }).should('have.text', 'Driver found');
    cy.phone('alice').find(tid('ride-fare')).should('have.text', '$10.75');
    cy.phone('james').find(tid('driver-result')).should('have.text', 'That request closed before you answered');
    cy.phone('james').find(tid('offer')).should('not.exist');
  });

  it('tells the rider when every driver passes', () => {
    cy.resetDispatch();
    cy.openPhones([alice, maria, james]);
    cy.requestRide('alice', 'ferry', 'Ferry Building');

    cy.pass('maria');
    cy.pass('james');

    cy.phone('alice').find(tid('ride-status')).should('have.text', 'No drivers available');
    cy.waitForDispatch((s) => s.rides[0]?.status === 'unmatched', 'ride unmatched');

    // Going back lets the rider try again with a fresh auction.
    cy.phone('alice').find(tid('unmatched-back')).click();
    cy.phone('alice').find(tid('confirm-ride')).click();
    cy.phone('maria').find(tid('offer')).should('have.length', 1);
    cy.waitForDispatch((s) => s.rides.length === 2 && s.rides[1].status === 'auction', 'second auction open');
  });

  it('withdraws the offer from every driver when the rider cancels', () => {
    cy.resetDispatch();
    cy.openPhones([alice, maria, james]);
    cy.requestRide('alice', 'ferry', 'Ferry Building');

    cy.bid('maria', 9);
    cy.phone('alice').find(tid('cancel-request')).click();
    cy.phone('alice').find(tid('confirm-ride')).should('exist');

    for (const driver of ['maria', 'james']) {
      cy.phone(driver).find(tid('offer')).should('not.exist');
      cy.phone(driver).find(tid('driver-result')).should('have.text', 'The rider cancelled their request');
    }
    cy.waitForDispatch((s) => s.rides[0]?.status === 'cancelled', 'ride cancelled');
  });

  it('never gives one driver two rides at once', () => {
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
});
