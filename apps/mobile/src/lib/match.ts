const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** True when `text` contains `query`, ignoring case and accents ("kuche" finds "Küche"); a blank query matches all. */
export const matches = (text: string, query: string) => plain(text).includes(plain(query.trim()))
