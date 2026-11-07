import { openSupport, supportMailto } from './support'

test('the mail goes to support with the job number and title encoded', () => {
  const url = supportMailto({ number: 1042, title: 'Fix & paint "door"' }, 'en')
  expect(url.startsWith('mailto:info@skillweb.space?subject=')).toBe(true)
  const q = new URLSearchParams(url.split('?')[1])
  expect(q.get('subject')).toBe('Help with job #1042: Fix & paint "door"')
  expect(q.get('body')).toContain('#1042')
  expect(url).not.toMatch(/ |"/)
})

test('German subject', () => {
  expect(new URLSearchParams(supportMailto({ number: 7, title: 'Garten' }, 'de').split('?')[1]).get('subject')).toBe('Hilfe zu Auftrag #7: Garten')
})

const subject = (job: { number?: number; title?: string }, lang: 'de' | 'en') => new URLSearchParams(supportMailto(job, lang).split('?')[1]).get('subject')

test('a booking without a job number never prints #0 or an empty title', () => {
  expect(subject({}, 'en')).toBe('Help with my booking')
  expect(subject({ number: 0, title: 'X' }, 'de')).toBe('Hilfe zu meiner Buchung')
  expect(subject({ number: 12 }, 'en')).toBe('Help with job #12')
  expect(subject({ number: 12, title: '' }, 'de')).toBe('Hilfe zu Auftrag #12')
})

describe('openSupport', () => {
  const { Alert, Linking } = jest.requireActual('react-native')
  afterEach(() => jest.restoreAllMocks())

  test('without a mail app the address is shown', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no mail app'))
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    openSupport({ number: 3, title: 'T' })
    await new Promise<void>((r) => setImmediate(r))
    expect(alert).toHaveBeenCalledTimes(1)
    expect(alert.mock.calls[0][1]).toContain('info@skillweb.space')
  })

  test('with a mail app nothing is shown', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    openSupport({ number: 3, title: 'T' })
    await new Promise<void>((r) => setImmediate(r))
    expect(open).toHaveBeenCalled()
    expect(alert).not.toHaveBeenCalled()
  })
})
