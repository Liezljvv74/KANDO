import { legalUrl } from './legal-links'

describe('legalUrl', () => {
  it('German is the default language: no query', () => {
    expect(legalUrl('agb', 'de', 'https://x')).toBe('https://x/agb')
    expect(legalUrl('datenschutz', 'de', 'https://x')).toBe('https://x/datenschutz')
  })
  it('English adds ?lang=en', () => {
    expect(legalUrl('impressum', 'en', 'https://x')).toBe('https://x/impressum?lang=en')
  })
})
