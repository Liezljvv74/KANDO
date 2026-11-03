import { expect, it } from 'vitest'
import { MAX_OPEN_REQUESTS_PER_PAIR } from '@kando/domain'
import { de, en } from '@kando/i18n'

// The app turns the server's code `request-limit` into this text and has no way to know the number, so the number is written in
// the text. This spec keeps it equal to the constant the server enforces.
it('the request-limit text names the same number as MAX_OPEN_REQUESTS_PER_PAIR, in German and English', () => {
  for (const text of [de['error.booking.request-limit'], en['error.booking.request-limit']]) {
    expect(text.match(/\d+/g)).toEqual([String(MAX_OPEN_REQUESTS_PER_PAIR)])
  }
})
