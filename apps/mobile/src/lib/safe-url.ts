/** Links from the server are opened only when they are https. */
export const isHttps = (url: unknown): url is string => typeof url === 'string' && url.startsWith('https://')

/** The support mail link the app builds itself is opened with the mail app. */
export const isMailto = (url: unknown): url is string => typeof url === 'string' && url.startsWith('mailto:')
