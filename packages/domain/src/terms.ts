import { TERMS_VERSION } from '@kando/contract'

type Accepted = { termsAcceptedAt: Date | null; termsVersion: string | null }

/** Accepted an older version of the terms: the app asks again. */
export const termsStale = (row: Accepted) => row.termsAcceptedAt !== null && row.termsVersion !== TERMS_VERSION

/** Accepted the current version. */
export const termsCurrent = (row: Accepted) => row.termsAcceptedAt !== null && row.termsVersion === TERMS_VERSION
