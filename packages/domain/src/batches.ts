/** Runs `fn` on every item, at most `size` at a time (the next batch starts when the whole batch is done). `fn` must not reject (the email senders catch their own errors). */
export async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn))
}
