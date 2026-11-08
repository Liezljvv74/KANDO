/**
 * A load that started before the last save must not replace what that save answered (a reload in flight when the app comes
 * back to the front, or a retry, can land after a save). `start()` at the start of a load returns a check that is true while
 * no save happened since; `saved(value)` records each save's answer, `latest()` gives the newest one.
 */
export function createSaveGuard<T>() {
  let saves = 0
  let last: T | undefined
  return {
    saved: (value: T) => {
      saves++
      last = value
    },
    start: () => {
      const at = saves
      return () => at === saves
    },
    latest: () => last,
  }
}

/** What a load may show: its own answer, unless a save happened since it started (then the save's answer). */
export const freshOr = <T>(loaded: T, fresh: boolean, latest: T | undefined): T => (fresh || latest === undefined ? loaded : latest)
