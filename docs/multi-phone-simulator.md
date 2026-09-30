# Multi-phone simulator and auction tests

This setup runs several "phones" at once in one browser, without iOS simulators, and drives them through scripted scenarios with Cypress. Each phone is the web build of the app, running in its own iframe. The phones talk to a shared **dispatch server**, which matches riders to drivers with a price auction.

```
┌──────────────────────────── /sim.html (Expo dev server, :8090) ───────────────────────────┐
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   ┌──────────────┐                    │
│  │ Alice   │  │ Maria   │  │ James   │  │ Aisha   │   │ Dispatch     │  live view of      │
│  │ rider   │  │ driver  │  │ driver  │  │ driver  │   │ panel        │  GET /state        │
│  │ iframe  │  │ iframe  │  │ iframe  │  │ iframe  │   └──────────────┘                    │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘                                       │
└───────┼────────────┼────────────┼────────────┼────────────────────────────────────────────┘
        └────────────┴─── WebSocket ───────────┴──────►  server/dispatch.mts (:8787)
                                                              ▲
                         Cypress: drives the iframes ─────────┘ cy.request: reset / inspect
```

## Quick start

```bash
npm run e2e        # start dispatch + web server, run every scenario headlessly, shut down
npm run e2e:open   # same, but in the Cypress UI so you can watch the phones
npm run e2e:slow   # every scenario at watching speed, in a visible Chrome window
```

In the Cypress UI, each scenario is its own spec, and `slow/` holds a slow version of each. Pick one to watch it, or use **Run all specs** to play them back to back. `npm run e2e` runs only the normal-speed specs. To run one scenario headlessly, start the servers (below) and run `npx cypress run --spec cypress/e2e/lowest-bid-wins.cy.ts`.

To explore by hand, start the two servers yourself:

```bash
npm run dispatch   # auction server on :8787
npm run sim:web    # Expo dev server on :8090
```

Then open <http://localhost:8090/sim.html?phones=rider:alice:Alice,driver:maria:Maria,driver:james:James>.

> The simulator page is also served by your normal dev server (`npm start`, port 8081) at `/sim.html`. Tests use port 8090 so they never collide with it.

## How the auction works

The dispatch server holds a sealed-bid auction:

1. A rider requests a ride. The fare shown to them on the ride-options sheet becomes the **ceiling** (`maxFare`).
2. Every driver who is **online and not on a trip** at that moment is invited. If none are, the auction closes immediately as `unmatched`.
3. Each invited driver gets **one** response: a bid (more than $0, at or below the ceiling) or a pass. Drivers never see each other's bids.
4. The auction closes when either:
   - every invited driver has bid or passed (or is now on another trip), or
   - the auction window runs out (15 s by default; see `auctionDurationMs`).
5. The **lowest bid wins**, and a tie goes to the earliest bid. A bidder who won a different auction in the meantime is skipped. The rider pays the winning bid.
6. The winning driver taps **Complete trip**. The rider's phone moves to "You've arrived", and the trip is saved to that rider's history.

Ride statuses: `auction` → `matched` → `completed`, or `auction` → `unmatched` / `cancelled`.

What each driver sees afterwards:

| Situation                        | Driver banner                                   |
| -------------------------------- | ----------------------------------------------- |
| Bid but lost                     | "Another driver won that ride"                  |
| Never answered before the window | "That request closed before you answered"       |
| Rider cancelled                  | "The rider cancelled their request"             |
| Passed                           | nothing (back to "Waiting for ride requests")   |
| Won, then completed the trip     | "Trip complete · you earned $X"                 |

## Pieces

| Path                                   | What it is                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `server/dispatch.mts`                  | Dispatch server: WebSocket for phones, HTTP for state and test control. Run directly by Node (type stripping, no build step). |
| `src/lib/dispatch/protocol.ts`         | Message and snapshot types shared by the app and the server.                |
| `src/lib/dispatch/device.ts`           | Who this phone is (from the URL on web) and where dispatch lives.           |
| `src/lib/dispatch/DispatchContext.tsx` | WebSocket client: connects, says hello, reconnects, exposes the latest snapshot. |
| `src/lib/RideContext.tsx`              | Rider state: `requestRide`, `cancelRide`, `dismissRide` and `completeTrip` go through dispatch. |
| `src/app/finding.tsx`                  | Rider's auction / driver found / no drivers screen.                         |
| `src/app/driver.tsx`                   | Driver screen: offers, bid input, current job, result banner.               |
| `src/components/RideMap.tsx` / `.web.tsx` | Native map, and a plain backdrop on web (`react-native-maps` has no web build). |
| `public/sim.html`                      | The simulator page: phones as iframes plus the live dispatch panel.         |
| `cypress/support/e2e.ts`               | Custom commands, network fixtures, and `defineScenario`.                    |
| `cypress/support/phones.ts`            | The shared cast: riders Alice and Bob; drivers Maria, James and Aisha.      |
| `cypress/scenarios/<name>.ts`          | One scenario's steps and assertions.                                        |
| `cypress/e2e/<name>.cy.ts`             | A thin spec that registers one scenario at normal speed.                    |
| `cypress/e2e/slow/<name>.cy.ts`        | The same scenario at watching speed.                                        |
| `cypress/support/pace.ts`              | `runScenario`, pace settings, and `scaled()` for time windows.              |

### Scenarios

| Spec                        | Checks                                                                         |
| --------------------------- | ------------------------------------------------------------------------------ |
| `lowest-bid-wins`           | Lowest bid wins, the losers are told, and the trip runs to "You've arrived".   |
| `tie-goes-to-earlier-bid`   | Equal bids go to whoever bid first.                                            |
| `bid-capped-at-quote`       | A bid above the rider's quoted fare can't be submitted.                        |
| `auction-deadline`          | The auction closes on its deadline and a driver who never answered is told.    |
| `every-driver-passes`       | The rider sees "No drivers available" and can request again.                   |
| `rider-cancels`             | Cancelling withdraws the offer from every driver.                              |
| `one-ride-per-driver`       | A driver who wins one ride isn't awarded another at the same time.             |

### Protocol

The server is the source of truth. After **every** change, it pushes a full snapshot to every connected device, so clients never have to replay missed events.

- Client → server: `hello`, `requestRide`, `cancelRide`, `ackRide`, `bid`, `decline`, `completeTrip`
- Server → client: `snapshot` (the rider's current ride, or the driver's offers, job and last result) and `error` (a rejected action, shown on screen)

A rider's ride stays in their snapshot until they acknowledge it (`ackRide`: tapping **Done** on the trip screen or **Back** on "No drivers available").

## The simulator page

```
/sim.html?phones=<spec>,<spec>,...[&dispatch=http://host:8787]
spec = role:id:name[:car[:plate[:rating]]]
```

- `role` is `rider` or `driver`. Riders open on `/`, drivers on `/driver`.
- `id` must be unique. Cypress uses it to find the phone (`iframe[data-phone="<id>"]`), and dispatch uses it as the device id.
- Each part may be URL-encoded, e.g. `driver:maria:Maria:Toyota%20Camry:7KDL294:4.95`.
- `dispatch` defaults to the page's host on port 8787.

A phone reads its identity from its URL once, at startup, before the router rewrites the URL. Because every phone shares one browser origin, trip history and recent places are stored under a per-phone key prefix (`<id>:trips`).

**Why iframes on the same origin:** Cypress can only reach into iframes that share the test page's origin. The simulator page is served from `public/` by the Expo dev server, the same origin as the app, for exactly this reason. Don't host it anywhere else.

## Dispatch HTTP API

| Method and path                 | Purpose                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `GET /state`                    | Devices (online/busy), rides, bids, passes, winners, and config. Used by the simulator panel and by assertions. |
| `POST /test/reset`              | Clears all rides and results. Body `{ "auctionDurationMs": 4000 }` sets the window (default 15000). Connected phones stay connected. |
| `POST /test/rides/:id/close`    | Closes an auction now, as if its window ran out.                        |

Environment variables: `PORT` (default 8787) and `AUCTION_MS` (default auction window).

## Writing scenarios

A scenario's steps live in `cypress/scenarios/`, apart from the spec file that runs them, so the same steps can back more than one spec. Add both files:

```ts
// cypress/scenarios/lowest-bid-wins.ts
import { defineScenario, tid } from '../support/e2e';
import { alice, james, maria } from '../support/phones';

export default defineScenario('lowest bid wins', () => {
  cy.resetDispatch();                          // always first: dispatch state outlives page loads
  cy.openPhones([alice, maria, james]);        // waits until every phone is rendered and connected

  cy.requestRide('alice', 'ferry', 'Ferry Building');
  cy.bid('maria', 10);
  cy.bid('james', 8.5);                        // last answer closes the auction

  cy.phone('alice').find(tid('ride-fare')).should('have.text', '$8.50');
  cy.phone('maria').find(tid('driver-result')).should('have.text', 'Another driver won that ride');
  cy.waitForDispatch((s) => s.rides[0]?.winnerId === 'james', 'james won');
});
```

```ts
// cypress/e2e/lowest-bid-wins.cy.ts
import scenario from '../scenarios/lowest-bid-wins';
import { runScenario } from '../support/pace';

runScenario(scenario);
```

```ts
// cypress/e2e/slow/lowest-bid-wins.cy.ts
import scenario from '../../scenarios/lowest-bid-wins';
import { runScenario } from '../../support/pace';

runScenario(scenario, 'slow');
```

Each scenario starts with `cy.resetDispatch()` and opens its own phones, so any spec can run alone or in any order.

### Commands

| Command                                              | Does                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `cy.resetDispatch({ auctionDurationMs? })`           | `POST /test/reset`.                                                   |
| `cy.openPhones(phones)`                              | Loads `/sim.html` with those phones and waits until each is on screen and connected to dispatch. |
| `cy.phone(id)`                                       | Yields that phone's `<body>`. Chain `.find(...)` / `.contains(...)` from it. |
| `cy.requestRide(riderId, query, placeTitle)`         | Searches, picks the place, taps **Choose UberX**, waits for "Finding your driver". |
| `cy.bid(driverId, amount, { rider? })`               | Enters and submits a bid. Pass `rider` (the rider's name) when the driver has several offers. |
| `cy.pass(driverId, { rider? })`                      | Passes on an offer.                                                   |
| `cy.dispatchState()`                                 | `GET /state` once.                                                    |
| `cy.waitForDispatch(check, description)`             | Polls `/state` until `check(state)` is true (fails after the command timeout). |
| `tid(id)`                                            | Selector for a React Native `testID` (react-native-web renders it as `data-testid`). |

### Test IDs

| Screen              | IDs                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------- |
| Home / search       | `where-to`, `destination-input`, `confirm-ride`, `price-<rideTypeId>`, `dispatch-error`  |
| Rider: finding      | `ride-status`, `offer-count`, `cancel-request`, `ride-fare`, `matched-driver`, `driver-name`, `unmatched-back` |
| Rider: trip done    | `ride-status` ("You've arrived"), `trip-done`                                            |
| Driver              | `driver-status`, `driver-idle`, `driver-error`, `driver-result`, `offer`, `offer-destination`, `offer-max-fare`, `offer-my-bid`, `bid-input`, `submit-bid`, `decline-offer`, `driver-job`, `job-fare`, `complete-trip` |

When you add UI that a scenario needs to touch, give it a `testID` rather than matching on text or styles.

### Network fixtures

Place search (Photon) and routing (OSRM) are external services, so every test stubs them in a global `beforeEach`:

- Any search returns **Ferry Building** (`cypress/fixtures/photon-ferry-building.json`).
- Any route is **5 km / 10 min** (`cypress/fixtures/osrm-5km.json`).

So the quoted fares are: UberX **$11.00**, Comfort $14.00, UberXL $17.50, Black $26.00. To test other fares, add a fixture and override the intercept inside the test.

### Slow runs

A slow spec plays the same steps for a human to follow:

- Every `cy.phone(...)` step pauses first (800 ms) and outlines that phone in blue in the simulator.
- Typing is visible (150 ms per key).
- Each scenario holds its final screen for 5 s before the next spec loads or the window closes.
- Time windows are stretched 4×. `cy.resetDispatch()` without an explicit window gets 60 s instead of 15 s.

Tune these in `PACES` in `cypress/support/pace.ts`. If a scenario depends on a time window, wrap the numbers in `scaled()` so it still holds when slow:

```ts
cy.resetDispatch({ auctionDurationMs: scaled(4000) });
cy.phone('alice').find(tid('ride-status'), { timeout: scaled(8000) }).should('have.text', 'Driver found');
```

Use `typeDelayMs()` for any `.type()` a scenario does directly. The pace is set when each test starts, so normal and slow specs can share one "Run all specs" session.

### Timing tips

- Prefer letting every invited driver answer; the auction then closes at once, with no waiting.
- To test the deadline, reset with a short window (`cy.resetDispatch({ auctionDurationMs: 4000 })`) and give the waiting assertion a longer `timeout`.
- `cy.bid` doesn't assert anything after submitting, because the offer card disappears if that bid closes the auction. Assert the outcome on the phones you care about.

## Running the app on a device

Riders now get drivers only through dispatch, so run `npm run dispatch` alongside `npm start`. The app finds the server on the same host as the Metro dev server, port 8787. This works for simulators, emulators and physical devices on the same network. Override it with `EXPO_PUBLIC_DISPATCH_URL=ws://host:port`.

On a device, the app is always a rider (a random device id, named "You"). The driver role is only reachable through the simulator URL.

## Troubleshooting

- **Phones are blank in the simulator.** The web bundle failed to build. Open one phone's URL (e.g. `/?device=x`) directly to see the error. If you installed packages while a dev server was running, restart it with `npx expo start --clear`: a stale Metro file map can point at packages that have moved.
- **"Can't reach dispatch" in the panel, or drivers stuck on "Connecting…".** The dispatch server isn't running, or something else holds port 8787.
- **`npm run e2e` fails straight away with a port error.** Stop any `npm run dispatch` or `npm run sim:web` you started by hand; the e2e script starts its own.
- **Cypress says `Cypress.env()` was removed.** This project is on Cypress 16. Non-secret config lives under `expose` in `cypress.config.ts` and is read with `Cypress.expose('dispatchUrl')`.
