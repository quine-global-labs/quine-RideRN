// Multi-phone e2e tests. `npm run e2e` starts the dispatch server and the web dev server,
// then runs every scenario headlessly; `npm run e2e:open` does the same in the Cypress UI.

import { defineConfig } from 'cypress';

export default defineConfig({
  // Readable from specs via Cypress.expose().
  expose: { dispatchUrl: 'http://localhost:8787' },
  e2e: {
    // A dedicated Expo dev server (npm run sim:web), which also serves the simulator page
    // (public/sim.html). It's kept off 8081 so it never collides with your everyday dev server.
    baseUrl: 'http://localhost:8090',
    // Wide enough to show several phones side by side.
    viewportWidth: 1900,
    viewportHeight: 900,
    // Every phone loads the full dev bundle; the first run also waits on Metro compiling it.
    pageLoadTimeout: 120_000,
    defaultCommandTimeout: 10_000,
    video: false,
    // Adds "Run all specs" to `npm run e2e:open`, to play every scenario back to back.
    experimentalRunAllSpecs: true,
  },
});
