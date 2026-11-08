import { headerCells, type HeaderJob } from '@/lib/job-header'

// local time on purpose: the header shows the phone's own clock
const sat = new Date(2026, 10, 14, 14, 0).toISOString()
const job: HeaderJob = { jobNumber: 1040, otherParty: 'Maximilian K.', startAt: sat, durationMin: 60, onSite: true, address: { postcode: '10115', city: 'Berlin' } }

test('headerCells returns six cells in order', () => {
  expect(headerCells(job, 'customer', 'en')).toEqual([
    { label: 'Job #', value: '1040' },
    { label: 'Provider', value: 'Maximilian K.' },
    { label: 'Date', value: "Sat 14 Nov '26" },
    { label: 'Time', value: '14:00' },
    { label: 'Duration', value: '60 min' },
    { label: 'Location', value: '10115 Berlin' },
  ])
})

test('German date format', () => {
  const cells = headerCells({ ...job, startAt: new Date(2026, 10, 25, 9, 5).toISOString() }, 'customer', 'de')
  expect(cells[2]).toEqual({ label: 'Datum', value: "25.11.'26" })
  expect(cells[3]!.value).toBe('09:05')
  expect(cells[4]!.value).toBe('60 Min.')
})

test('Customer label for the provider and Provider label for the customer', () => {
  expect(headerCells(job, 'provider', 'en')[1]!.label).toBe('Customer')
  expect(headerCells(job, 'customer', 'en')[1]!.label).toBe('Provider')
  expect(headerCells(job, 'provider', 'de')[1]!.label).toBe('Kunde')
})

test('a request without an agreed time shows dashes', () => {
  const cells = headerCells({ jobNumber: 1041, startAt: null, durationMin: null, onSite: null, address: null }, 'customer', 'en')
  expect(cells.map((c) => c.value)).toEqual(['1041', '-', '-', '-', '-', '-'])
})

test('remote work says so instead of a place', () => {
  expect(headerCells({ ...job, onSite: false, address: null }, 'customer', 'en')[5]!.value).toBe('Remote')
})
