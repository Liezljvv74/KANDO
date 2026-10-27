/**
 * Answers can arrive out of order. `stamp()` marks a request when it starts; the function it returns is true (once) only
 * while no newer request has been applied, so an older answer never replaces a newer one.
 */
export function createStaleGuard() {
  let started = 0
  let applied = 0
  return () => {
    const n = ++started
    return () => n > applied && ((applied = n), true)
  }
}
