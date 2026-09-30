// How fast a scenario plays. Slow runs are for watching: every step on a phone pauses
// first and highlights that phone, typing is visible, and time windows stretch so the
// scenario still holds at that speed.

import type { Scenario } from './e2e';

export type Pace = 'normal' | 'slow';

const PACES = {
  normal: { stepDelayMs: 0, typeDelayMs: 10, timeScale: 1, endPauseMs: 0 },
  // endPauseMs holds the final screen before the next spec loads or the window closes.
  slow: { stepDelayMs: 800, typeDelayMs: 150, timeScale: 4, endPauseMs: 5000 },
} satisfies Record<Pace, { stepDelayMs: number; typeDelayMs: number; timeScale: number; endPauseMs: number }>;

let current: Pace = 'normal';

export const isSlow = () => current === 'slow';
export const stepDelayMs = () => PACES[current].stepDelayMs;
export const typeDelayMs = () => PACES[current].typeDelayMs;

/** Stretch a duration (auction window, assertion timeout) to fit the current pace. */
export const scaled = (ms: number) => ms * PACES[current].timeScale;

/**
 * Register a scenario as a test at the given pace. The pace is set when the test runs,
 * not when it's registered, because "Run all specs" loads every spec into one page.
 */
export function runScenario(scenario: Scenario, pace: Pace = 'normal') {
  it(pace === 'slow' ? `${scenario.title} (slow)` : scenario.title, () => {
    current = pace;
    scenario.run();
    const { endPauseMs } = PACES[pace];
    if (endPauseMs > 0) cy.wait(endPauseMs, { log: false });
  });
}
