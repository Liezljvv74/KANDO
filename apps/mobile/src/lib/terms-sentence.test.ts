import { de, en } from '@kando/i18n'

import { splitSentence } from './terms-sentence'

const labels = { terms: 'T', privacy: 'P' }

test('splits at the placeholders and keeps the order of the sentence', () => {
  expect(splitSentence('a {terms} b {privacy}.', labels)).toEqual([{ text: 'a ' }, { text: 'T', link: 'terms' }, { text: ' b ' }, { text: 'P', link: 'privacy' }, { text: '.' }])
  expect(splitSentence('{privacy} then {terms}', labels).map((p) => p.link)).toEqual(['privacy', undefined, 'terms'])
})

test.each([['de', de], ['en', en]])('the %s sentence has both placeholders once', (_l, d) => {
  const s = (d as Record<string, string>)['auth.termsSentence']
  expect(s.match(/\{terms\}/g)).toHaveLength(1)
  expect(s.match(/\{privacy\}/g)).toHaveLength(1)
})
