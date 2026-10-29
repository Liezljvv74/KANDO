export type PayoutState = 'unknown' | 'notFinished' | 'waiting' | 'ready'

/** The server only says ready or not; "waiting" is when this person has opened the Stripe page (in this session) without finishing. Without an answer the state is unknown. */
export const payoutState = (ready: boolean | undefined, opened: boolean): PayoutState => (ready === undefined ? 'unknown' : ready ? 'ready' : opened ? 'waiting' : 'notFinished')
