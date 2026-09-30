// Types for test hooks the app exposes on web dev builds. Types only, so Cypress can share them.

/**
 * Set on each phone's window as `__dispatchLink`. Holding the link freezes the phone's view
 * of dispatch: what it sends is queued and what it receives is buffered, while the app keeps
 * running on what it last saw. Releasing sends the queue in order, then delivers the buffered
 * messages. Tests use it to stage races, e.g. two drivers accepting the same ride before
 * either hears about the other.
 */
export type DispatchLinkControl = { hold: () => void; release: () => void; readonly held: boolean };

declare global {
  interface Window {
    __dispatchLink?: DispatchLinkControl;
  }
}
