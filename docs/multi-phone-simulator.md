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

## Two apps: rider and driver

The codebase builds two apps, distributed separately:

| App           | Name            | Bundle ID / package          | Scheme          | Screens                     |
| ------------- | --------------- | ---------------------------- | --------------- | --------------------------- |
| Rider (default) | RideRN        | `com.example.ridern`         | `ridern`        | home, search, finding, trip, trips |
| Driver        | RideRN Driver   | `com.example.ridern.driver`  | `ridern-driver` | driver                      |

`APP_VARIANT=driver` selects the driver app (`app.config.ts`, on top of `app.json`). The root layout guards each app's screens with `Stack.Protected`, so the driver app can't reach rider screens and vice versa; opening a guarded route, including `/` in the driver app, lands on the first allowed screen.

```bash
npm start                                    # rider app dev server
npm run start:driver                         # driver app dev server
npx eas-cli@latest build --profile driver-production   # driver app store build
```

`eas.json` has `development`, `preview` and `production` profiles for the rider app, and `driver-development`, `driver-preview` and `driver-production` for the driver app.

In the simulator, both apps run from one dev server: each phone's `role` URL parameter picks which app it is.

## Quick start

```bash
npm run e2e        # start dispatch + web server, run every scenario headlessly, shut down
npm run e2e:open   # same, but in the Cypress UI so you can watch the phones
npm run e2e:slow   # every scenario at watching speed, in a visible Chrome window
```

In the Cypress UI, each scenario is its own spec, and `slow/` holds a slow version of each. Pick one to watch it, or use **Run all specs** to play them back to back. `npm run e2e` runs only the normal-speed specs. To run one scenario headlessly, start the servers (below) and run `npx cypress run --spec cypress/e2e/first-accept-wins.cy.ts`.

To explore by hand, start the two servers yourself:

```bash
npm run dispatch   # auction server on :8787
npm run sim:web    # Expo dev server on :8090
```

Then open <http://localhost:8090/sim.html?phones=rider:alice:Alice,driver:maria:Maria,driver:james:James>.

> The simulator page is also served by your normal dev server (`npm start`, port 8081) at `/sim.html`. Tests use port 8090 so they never collide with it.

## How the auction works

The dispatch server runs a rising-price auction in rounds:

1. A rider picks a destination and dispatch quotes each ride type upfront (rate cards and surge; see [`pricing.md`](pricing.md)). Booking a ride type makes its quoted fare the **quote** the auction works from.
2. Round 1 opens. Every **connected driver in driving mode with room for another ride** is offered the same **suggested fare** and taps **Accept** or **Pass**. A driver who becomes available mid-round (starts driving, reconnects, or finishes a trip) is offered that round too.
3. The **first driver to accept wins** at that round's price, and the auction ends immediately.
4. A round ends with no taker when every driver in it has passed (or has since gone offline or filled up), or when its time runs out.
5. Then the next round opens at a higher price and is offered again to every available driver, including those who passed.
6. When a round at the **price cap** ends with no taker, the ride is `unmatched` and the rider sees "No drivers available". With no cap, rounds continue until someone accepts or the rider cancels.
7. The winning driver taps **Complete trip**. The rider's phone moves to "You've arrived", and the trip is saved to that rider's history. If the driver has a ride queued, it becomes their current one.

Ride statuses: `auction` → `matched` → `completed`, or `auction` → `unmatched` / `cancelled`.

Each accept or pass names the round it answers. If the price moved on in the meantime, the server rejects it ("The price changed"), so no driver can accept a price they didn't see.

When two drivers accept the same round, **whichever accept reaches the server first wins**. Later ones get "Another driver already took this ride" and are recorded on the round as `lateAccepts`, in arrival order.

### Driving mode

Drivers only get ride requests while in **driving mode**:

- **Offline:** "You're offline" with a **Start driving** button. No requests arrive. The driver app always starts offline.
- **Driving, no ride:** a "Looking for ride requests" animation.
- **Driving, on a ride:** turn-by-turn directions to the rider. There's no real routing yet: `src/lib/navigation.ts` holds a simulated route whose steps advance every 5 s.

A ride request can arrive in either driving state. It **interrupts** whatever is on screen: a sheet slides up over the waiting animation or the directions, and the directions stay mounted and keep advancing underneath.

- **Pass** dismisses the sheet and leaves a small "You passed at $X" note. If a later round raises the price, the sheet pops up again.
- **Accept** while waiting starts that ride: directions to the pickup.
- **Accept** while on a ride **queues** it as the driver's next ride ("Next: Bob → …"); the current directions carry on untouched. The queued rider sees "James is finishing a nearby trip, then heading to you". A driver can hold **one ride in progress plus one queued** (`MAX_RIDES_PER_DRIVER`); when full, they get no requests until they complete a trip.
- **Go offline** stops new requests at any time, including from the request sheet. Rides already accepted continue. Going offline mid-round drops the driver from it; starting mid-round joins it.

The phone owns the setting and tells dispatch on every connect (`setDriving`), so a reconnect never silently changes it. `POST /test/reset` sets every driver back to offline until their phone says otherwise.

### Pricing policy

There's no real pricing model yet, so the auction is driven by a configurable **policy**. Prices are multiples of the rider's quote:

| Field             | Meaning                                                                  | Default   |
| ----------------- | ------------------------------------------------------------------------ | --------- |
| `startMultiplier` | Round 1 price = quote × this                                             | `0.8`     |
| `stepMultiplier`  | Each later round adds quote × this                                       | `0.05`    |
| `maxMultiplier`   | Cap = quote × this; the round that reaches it is the last. `null` = no cap | `1`       |
| `roundDurationMs` | How long each round waits for an answer                                  | `15000`   |

With the defaults and an $11.00 quote, rounds offer $8.80, $9.35, $9.90, $10.45 and $11.00, so the rider never pays more than quoted. Those numbers are placeholders, not a pricing decision.

The policy can be set:

- **When starting the server**, with `AUCTION_START`, `AUCTION_STEP`, `AUCTION_MAX` (`none` for no cap) and `AUCTION_ROUND_MS`.
- **Per test**, with `POST /test/reset` (below) or `cy.resetDispatch({ ...overrides })`.

Each ride keeps the policy it started with. `policyFor(request)` in `server/dispatch.mts` picks it; today it returns the one global policy, and it is the place to vary pricing by locality, ride type or time of day.

What each driver sees after a ride is decided:

| Situation                                   | Driver banner                                   |
| ------------------------------------------- | ----------------------------------------------- |
| Didn't answer and another driver accepted   | "Another driver took that ride"                 |
| Didn't answer the final round               | "That request closed before you answered"       |
| Rider cancelled                             | "The rider cancelled their request"             |
| Passed                                      | nothing (back to what they were doing)          |
| Won, then completed the trip                | "Trip complete · you earned $X"                 |

## Pieces

| Path                                   | What it is                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `server/dispatch.mts`                  | Dispatch server: WebSocket for phones, HTTP for state and test control. Run directly by Node (type stripping, no build step). |
| `server/pricing.mts`                   | The pricing model: rate cards, surge by zone, driver share ([`pricing.md`](pricing.md)). |
| `src/lib/dispatch/protocol.ts`         | Message and snapshot types shared by the app and the server.                |
| `src/lib/dispatch/device.ts`           | Which app this is, who this phone is (from the URL in the simulator), and where dispatch lives. |
| `src/lib/dispatch/DispatchContext.tsx` | WebSocket client: connects, says hello, reconnects, exposes the latest snapshot. Also the pause hook (below). |
| `src/lib/dispatch/testHooks.ts`        | Types for the test hooks on each phone's `window`.                           |
| `src/lib/RideContext.tsx`              | Rider state: `requestRide`, `cancelRide`, `dismissRide` and `completeTrip` go through dispatch. |
| `src/app/finding.tsx`                  | Rider's auction / driver found / no drivers screen.                         |
| `app.config.ts`, `eas.json`            | The two app variants and their build profiles.                              |
| `metro.config.js`                      | Keys Metro's cache by app variant (see Troubleshooting).                    |
| `src/app/_layout.tsx`                  | Guards each app's screens with `Stack.Protected`.                           |
| `src/app/driver.tsx`                   | The driver app: offline / waiting / on-a-ride, ride requests over it, current and queued ride. |
| `src/components/DriverNavigation.tsx`  | Full-screen turn-by-turn directions that keep running under anything shown on top. |
| `src/lib/navigation.ts`                | The simulated route to a pickup.                                            |
| `src/lib/location.ts`                  | The default location: the pickup fallback, and simulated phones' position.  |
| `src/components/RideMap.tsx` / `.web.tsx` | Native map, and a plain backdrop on web (`react-native-maps` has no web build). |
| `public/sim.html`                      | The simulator page: phones as iframes plus the live dispatch panel.         |
| `cypress/support/e2e.ts`               | Custom commands, network fixtures, and `defineScenario`.                    |
| `cypress/support/phones.ts`            | The shared cast: riders Alice, Bob and Carol; drivers Maria, James and Aisha. |
| `cypress/scenarios/<name>.ts`          | One scenario's steps and assertions.                                        |
| `cypress/e2e/<name>.cy.ts`             | A thin spec that registers one scenario at normal speed.                    |
| `cypress/e2e/slow/<name>.cy.ts`        | The same scenario at watching speed.                                        |
| `cypress/support/pace.ts`              | `runScenario`, pace settings, and `scaled()` for time windows.              |

### Scenarios

| Spec                        | Checks                                                                         |
| --------------------------- | ------------------------------------------------------------------------------ |
| `first-accept-wins`                 | The first driver to accept wins, the others are told, and the trip runs to "You've arrived". |
| `price-rises-when-everyone-passes`  | When every driver passes, a new round offers everyone a higher price.          |
| `price-rises-when-round-times-out`  | A round that runs out of time is followed by a higher-priced one.              |
| `unmatched-at-price-cap`            | Nobody takes the capped price: "No drivers available", then a fresh request starts over at round 1. |
| `pricing-is-configurable`           | A policy that starts above the quote with no cap is followed, and the rider sees "above your quote". |
| `rider-cancels`                     | Cancelling withdraws the offer from every driver.                              |
| `offline-drivers-get-no-requests`   | Only drivers in driving mode are asked; starting mid-round joins it, going offline mid-round leaves it. |
| `offer-interrupts-driving`          | A request interrupts a waiting driver and a driver mid-ride; mid-ride, the directions keep running and accepting queues the ride; completing the trip moves on to it. |
| `base-rates`                        | Quotes follow San Francisco's rate cards, and the driver sees and earns their 75% share. |
| `fairbanks-rates`                   | A rider in Fairbanks gets Fairbanks prices (Comfort from Anchorage, no Black). |
| `surge-pricing`                     | Prices surge where requests outnumber drivers, drop when another driver starts driving there, and don't reach other zones. |
| `ride-queue-limit`                  | A driver can queue one ride behind the current one; when full they're skipped, and completing a trip lets them back in. |
| `mocked-location`                   | A phone placed at Union Square uses that position for search, routing and its pickup, with no location prompt. |
| `simultaneous-accepts`              | Two drivers accept at once: whoever reached dispatch first wins, even if they tapped second. |

### Protocol

The server is the source of truth. After **every** change, it pushes a full snapshot to every connected device, so clients never have to replay missed events.

- Client → server: `hello`, `requestQuote`, `requestRide`, `cancelRide`, `ackRide`, `accept`, `decline`, `completeTrip`, `setDriving`, `setPosition`
- Server → client: `snapshot` (the rider's latest quote and current ride; or the driver's driving mode, offers, current and queued job, and last result) and `error` (a rejected action, shown on screen)

A rider's ride stays in their snapshot until they acknowledge it (`ackRide`: tapping **Done** on the trip screen or **Back** on "No drivers available").

## The simulator page

```
/sim.html?phones=<spec>,<spec>,...[&dispatch=http://host:8787]
spec = role:id:name[:key=value...]
```

- `role` is `rider` or `driver`: which app the phone runs. Riders open on `/`, drivers on `/driver`.
- `id` must be unique. Cypress uses it to find the phone (`iframe[data-phone="<id>"]`), and dispatch uses it as the device id.
- Optional `key=value` parts, in any order:
  - `car`, `plate`, `rating`: how a driver appears to riders.
  - `lat`, `lng`: the phone's mocked location (see below).
  - `driving=0`: start a driver offline. Simulated drivers start in driving mode.
- Each part may be URL-encoded, e.g. `driver:maria:Maria:car=Toyota%20Camry:plate=7KDL294:driving=0`.
- `dispatch` defaults to the page's host on port 8787.

A phone reads its identity from its URL once, at startup, before the router rewrites the URL. Because every phone shares one browser origin, trip history and recent places are stored under a per-phone key prefix (`<id>:trips`).

**Location is mocked.** Simulated phones never call the real location API: there's nobody to answer a permission prompt, and the test machine's own position would leak into scenarios. Each phone sits at its `lat`/`lng`, or downtown San Francisco (37.7749, −122.4194) if none is given. That position is the rider's pickup, biases place search, and starts the route. A real device, or the web app opened outside the simulator (no `device` parameter), still uses real GPS. The logic is `simulatedLocation` in `src/lib/dispatch/device.ts`.

**Why iframes on the same origin:** Cypress can only reach into iframes that share the test page's origin. The simulator page is served from `public/` by the Expo dev server, the same origin as the app, for exactly this reason. Don't host it anywhere else.

## Dispatch HTTP API

| Method and path                 | Purpose                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `GET /state`                    | The policy and pricing, devices (online; drivers also `driving`, `jobs` and `position`), and every ride with its pickup, ride type, quoted fare, surge and rounds (price, who was offered it, who passed, who accepted). Used by the simulator panel and by assertions. |
| `POST /test/reset`              | Clears all rides, quotes and results and configures the server: body `{ "policy": { "startMultiplier": 1.2 }, "pricing": { "surge": { "enabled": false } } }`. Anything left out takes the server's defaults. Connected phones stay connected. |
| `POST /test/rides/:id/end-round` | Ends the current round now, as if its time ran out.                   |

Environment variables: `PORT` (default 8787), plus the policy variables above.

## Writing scenarios

A scenario's steps live in `cypress/scenarios/`, apart from the spec file that runs them, so the same steps can back more than one spec. Add both files:

```ts
// cypress/scenarios/second-round-wins.ts
import { defineScenario, tid } from '../support/e2e';
import { alice, james, maria } from '../support/phones';

export default defineScenario('second round wins', () => {
  cy.resetDispatch();                          // always first: dispatch state outlives page loads
  cy.openPhones([alice, maria, james]);        // waits until every phone is rendered and connected

  cy.requestRide('alice', 'ferry', 'Ferry Building');
  cy.pass('maria');
  cy.pass('james');                            // everyone passed: round 2 opens at once

  cy.phone('james').find(tid('offer-price')).should('have.text', '$9.35');
  cy.accept('james');

  cy.phone('alice').find(tid('ride-fare')).should('have.text', '$9.35');
  cy.waitForDispatch((s) => s.rides[0]?.winnerId === 'james', 'james won');
});
```

```ts
// cypress/e2e/second-round-wins.cy.ts
import scenario from '../scenarios/second-round-wins';
import { runScenario } from '../support/pace';

runScenario(scenario);
```

```ts
// cypress/e2e/slow/second-round-wins.cy.ts
import scenario from '../../scenarios/second-round-wins';
import { runScenario } from '../../support/pace';

runScenario(scenario, 'slow');
```

Each scenario starts with `cy.resetDispatch()` and opens its own phones, so any spec can run alone or in any order.

### Commands

| Command                                              | Does                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `cy.resetDispatch({ policy?, pricing?, rates? })`    | `POST /test/reset` with `TEST_POLICY` and `TEST_PRICING` plus any overrides; `rates: 'real'` uses the server's actual rate cards instead of the test card. `roundDurationMs` is stretched on slow runs. |
| `cy.openPhones(phones)`                              | Loads `/sim.html` with those phones and waits until each is on screen, connected, and (drivers) in its starting mode. A phone spec can set `location` and, for drivers, `driving: false`. |
| `cy.phone(id)`                                       | Yields that phone's `<body>`. Chain `.find(...)` / `.contains(...)` from it. |
| `cy.requestRide(riderId, query, placeTitle)`         | Searches, picks the place, taps **Choose UberX**, waits for "Finding your driver". |
| `cy.accept(driverId, { rider? })`                    | Accepts the suggested fare. Pass `rider` (the rider's name) when the driver has several offers. |
| `cy.pass(driverId, { rider? })`                      | Passes on the suggested fare.                                         |
| `cy.startDriving(id)` / `cy.goOffline(id)`           | Taps **Start driving** / **Go offline** and waits until dispatch has registered it. |
| `cy.pausePhone(id)`                                  | Holds that phone's link to dispatch (see below). The simulator marks it with a dashed amber outline. |
| `cy.resumePhone(id)`                                 | Sends what the phone queued, in order, then delivers what it missed.  |
| `cy.dispatchState()`                                 | `GET /state` once.                                                    |
| `cy.waitForDispatch(check, description)`             | Polls `/state` until `check(state)` is true (fails after the command timeout). |
| `tid(id)`                                            | Selector for a React Native `testID` (react-native-web renders it as `data-testid`). |

### Pausing a phone to stage races

Some bugs only show up when phones act on stale information, like two drivers accepting the same ride before either hears about the other. Normal Cypress steps run one after another, and each phone updates within milliseconds, so such races can't happen by accident in a test. Pausing a phone lets you set them up on purpose:

- While a phone is **paused**, the app keeps running on the last state it saw. You can tap its buttons as usual, but what it sends is queued, and updates from dispatch are buffered.
- **Resuming** sends its queued messages in order, then delivers the buffered updates, just as if its network had stalled and recovered.
- The order you resume phones in is the order their messages reach dispatch. That lets a test choose who wins a race, whatever order the taps happened in.

```ts
cy.pausePhone('maria');
cy.pausePhone('james');
cy.accept('maria');            // taps first...
cy.accept('james');
cy.resumePhone('james');       // ...but James's accept reaches dispatch first
cy.resumePhone('maria');       // Maria's arrives late: "Another driver already took this ride"
```

The hook is `window.__dispatchLink` (`hold()`, `release()`, `held`), set on each phone in web dev builds only. The connection itself stays open while paused, so dispatch still counts the phone as online.

### Test IDs

| Screen              | IDs                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------- |
| Home / search       | `where-to`, `destination-input`, `clear-destination`, `confirm-ride`, `price-<rideTypeId>`, `surge-notice`, `dispatch-error`  |
| Rider: finding      | `ride-status`, `round-price`, `round-number`, `cancel-request`, `ride-fare`, `fare-vs-quote`, `matched-driver`, `driver-name`, `driver-finishing`, `unmatched-back` |
| Rider: trip done    | `ride-status` ("You've arrived"), `trip-done`                                            |
| Driver              | `driver-offline`, `start-driving`, `stop-driving`, `driver-waiting`, `driver-navigation`, `nav-heading`, `nav-instruction`, `next-job`, `driver-status` (`Connecting…` / `Offline` / `Driving`), `driver-error`, `driver-result`, `offer-sheet`, `offer`, `offer-round`, `offer-destination`, `offer-earnings`, `offer-price`, `offer-passed`, `accept-offer`, `decline-offer`, `driver-job`, `job-earnings`, `job-fare`, `complete-trip` |

When you add UI that a scenario needs to touch, give it a `testID` rather than matching on text or styles.

### Network fixtures

Place search (Photon) and routing (OSRM) are external services, so every test stubs them in a global `beforeEach`:

- Any search returns **Ferry Building** (`cypress/fixtures/photon-ferry-building.json`).
- Any route is **5 km / 10 min** (`cypress/fixtures/osrm-5km.json`).

So the quoted fares are: UberX **$11.00**, Comfort $14.00, UberXL $17.50, Black $26.00. To test other fares, add a fixture and override the intercept inside the test.

The quoted fares come from dispatch, and tests don't rely on its defaults. `cy.resetDispatch()` always sends `TEST_POLICY` and `TEST_PRICING` from `cypress/support/e2e.ts`: a simple UberX card ($2.50 + $0.85/min) that prices the fixture trip at exactly **$11.00**, with surge off. So UberX rounds offer **$8.80, $9.35, $9.90, $10.45, $11.00**, and drivers earn 75% of that (`offer-earnings`), however the server was started. Scenarios about the real rates or surge opt in (`rates: 'real'`, `pricing: { surge: { enabled: true } }`).

### Slow runs

A slow spec plays the same steps for a human to follow:

- Every `cy.phone(...)` step pauses first (800 ms) and outlines that phone in blue in the simulator.
- Typing is visible (150 ms per key).
- Each scenario holds its final screen for 5 s before the next spec loads or the window closes.
- Time windows are stretched 4×. `cy.resetDispatch()` stretches `roundDurationMs` itself, so the default 15 s round becomes 60 s.

Tune these in `PACES` in `cypress/support/pace.ts`. If a scenario waits on a round running out, wrap that assertion's timeout in `scaled()` so it still holds when slow:

```ts
cy.resetDispatch({ policy: { roundDurationMs: 3000 } });   // stretched automatically
cy.phone('alice').find(tid('round-number'), { timeout: scaled(8000) }).should('have.text', 'Round 2');
```

Use `typeDelayMs()` for any `.type()` a scenario does directly. The pace is set when each test starts, so normal and slow specs can share one "Run all specs" session.

### Timing tips

- Prefer having every driver pass to move to the next round; it opens at once, with no waiting.
- To test a round timing out, reset with a short round (`cy.resetDispatch({ policy: { roundDurationMs: 3000 } })`) and give the waiting assertion a longer `timeout`.
- `cy.accept` and `cy.pass` don't assert anything after tapping, because the offer card changes or disappears straight away. Assert the outcome on the phones you care about.
- A short policy keeps cap tests quick, e.g. `{ policy: { startMultiplier: 0.9, stepMultiplier: 0.1, maxMultiplier: 1 } }` gives just two rounds.

## Running the app on a device

Riders now get drivers only through dispatch, so run `npm run dispatch` alongside `npm start`. The app finds the server on the same host as the Metro dev server, port 8787. This works for simulators, emulators and physical devices on the same network. Override it with `EXPO_PUBLIC_DISPATCH_URL=ws://host:port`.

Run the driver app with `npm run start:driver`. Outside the simulator, each install gets a random device id; riders are named "You" and drivers "Driver" until there are real accounts.

## Troubleshooting

- **The rider app shows up when you started the driver app, or the reverse.** The app config is baked into Metro's transform cache. `metro.config.js` keys the cache by `APP_VARIANT` so this shouldn't happen; if it does (say, after changing `app.config.ts`), start once with `--clear`.
- **Phones are blank in the simulator.** The web bundle failed to build. Open one phone's URL (e.g. `/?device=x`) directly to see the error. If you installed packages while a dev server was running, restart it with `npx expo start --clear`: a stale Metro file map can point at packages that have moved.
- **"Can't reach dispatch" in the panel, or drivers stuck on "Connecting…".** The dispatch server isn't running, or something else holds port 8787.
- **`npm run e2e` fails straight away with a port error.** Stop any `npm run dispatch` or `npm run sim:web` you started by hand; the e2e script starts its own.
- **Cypress says `Cypress.env()` was removed.** This project is on Cypress 16. Non-secret config lives under `expose` in `cypress.config.ts` and is read with `Cypress.expose('dispatchUrl')`.
