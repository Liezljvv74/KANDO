/** Runs `fn` on every item with at most `size` running at once (a sliding window: a slow item does not hold back the others). A rejecting item is logged and never stops the rest. */
export async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      try {
        await fn(items[next++]!)
      } catch (e) {
        console.error('[batch] item failed', e instanceof Error ? e.message : 'unknown')
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
}
