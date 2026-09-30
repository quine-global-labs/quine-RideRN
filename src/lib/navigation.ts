// Simulated turn-by-turn directions for the driver app. There's no real routing or GPS
// behind these yet; they give a driver on a ride a believable navigation screen.

export type NavStep = {
  /** Arrow glyph for the maneuver. */
  maneuver: string;
  distance: string;
  instruction: string;
};

export type NavRoute = {
  /** Shown above the directions, e.g. where the driver is heading. */
  heading: string;
  steps: NavStep[];
};

export function pickupRoute(riderName: string): NavRoute {
  return {
    heading: `Pick up ${riderName}`,
    steps: [
      { maneuver: '↑', distance: '400 m', instruction: 'Continue on Market St' },
      { maneuver: '↱', distance: '200 m', instruction: 'Turn right onto 4th St' },
      { maneuver: '↰', distance: '150 m', instruction: 'Turn left onto Folsom St' },
      { maneuver: '↱', distance: '300 m', instruction: 'Turn right onto Spear St' },
      { maneuver: '◉', distance: '50 m', instruction: `${riderName} is on the right` },
    ],
  };
}
