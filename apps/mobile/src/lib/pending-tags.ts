/**
 * Tag text that was typed but not yet added is saved when the user leaves the page or presses Publish. The profile
 * page registers one function that adds it and saves; the Publish button and the page's blur run `flushPendingTags`.
 */
const flushers = new Set<() => Promise<unknown>>()

/** Registers a flusher; the returned function removes it. */
export function registerPendingTags(flush: () => Promise<unknown>): () => void {
  flushers.add(flush)
  return () => void flushers.delete(flush)
}

/** Runs every registered flusher and waits for the saves; never rejects (a failed save shows next to its field). */
export async function flushPendingTags(): Promise<void> {
  await Promise.allSettled([...flushers].map((f) => f()))
}
