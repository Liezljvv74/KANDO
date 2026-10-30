import { AsyncLocalStorage } from 'node:async_hooks'

const scope = new AsyncLocalStorage<(() => Promise<void>)[]>()

/**
 * Runs `fn` with every network send it causes (email, push) collected into `sends` instead of going out; the caller owns
 * the array, so the collected sends survive a throw and the caller decides when they run (after the answer).
 */
export function withDeferredSends<T>(sends: (() => Promise<void>)[], fn: () => Promise<T>): Promise<T> {
  return scope.run(sends, fn)
}

/** Queues the send in the active scope: true = queued (the caller returns), false = no scope (the caller sends now). */
export function deferSend(fn: () => Promise<void>): boolean {
  const sends = scope.getStore()
  if (!sends) return false
  sends.push(fn)
  return true
}
