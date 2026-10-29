/** Links from the server are opened only when they are https. */
export const isHttps = (url: unknown): url is string => typeof url === 'string' && url.startsWith('https://')
