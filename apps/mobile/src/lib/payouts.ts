export type PayoutState = 'unknown' | 'notFinished' | 'waiting' | 'ready'

/** The server only says ready or not; "waiting" is when this person has opened the Stripe page (in this session) without finishing. Without an answer the state is unknown. */
export const payoutState = (ready: boolean | undefined, opened: boolean): PayoutState => (ready === undefined ? 'unknown' : ready ? 'ready' : opened ? 'waiting' : 'notFinished')

/** Shows a switch's new value at once and saves it; a failed save puts the old value back (the server still has it) and passes the error on. */
export async function saveSwitch(next: boolean, set: (v: boolean) => void, save: (v: boolean) => Promise<unknown>): Promise<void> {
  set(next)
  try {
    await save(next)
  } catch (e) {
    set(!next)
    throw e
  }
}
