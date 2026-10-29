// Chat constants, one place each (plan 2b, Global Constraints).

/** Longest chat message in characters. */
export const MAX_MESSAGE_CHARS = 2000
/** This many blocked contact-detail attempts inside the window flag the sender to staff. */
export const CONTACT_ATTEMPTS_LIMIT = 3
export const CONTACT_ATTEMPTS_WINDOW_HOURS = 24
/** At most one "new message" email per thread and recipient in this time. */
export const CHAT_EMAIL_THROTTLE_MINUTES = 30
/** Mobile polling interval for new messages. */
export const POLL_SECONDS = 4
/** Chat photo signed links are valid this long. */
export const CHAT_PHOTO_LINK_SECONDS = 600

/** Top-level domains that make a bare `word.tld` (or `word dot tld`) count as a link. */
export const CONTACT_LINK_TLDS = ['de', 'com', 'net', 'org', 'eu', 'io', 'me', 'info', 'app', 'co', 'za', 'at', 'ch'] as const
