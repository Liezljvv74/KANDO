import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { distanceKm, importPostcodes, isPostcode, lookupPostcode } from '@kando/db'

const file = resolve(__dirname, '../../../packages/db/data/postcodes-de.tsv')


it('imports the German file and looks up 01053 Dresden', async () => {
  expect(await importPostcodes('DE', file)).toBeGreaterThan(8000)
  expect(await importPostcodes('DE', file)).toBeGreaterThan(8000) // upsert, no duplicate error
  const hit = await lookupPostcode('DE', '01053')
  expect(hit).toMatchObject({ code: '01053', place: 'Dresden', state: 'Sachsen' })
  expect(hit?.lat).toBeCloseTo(51.0562, 3)
  expect(hit?.lng).toBeCloseTo(13.7323, 3)
})

it('rejects a four-digit German code and an unknown one', async () => {
  expect(await isPostcode('DE', '1011')).toBe(false)
  expect(await isPostcode('DE', '10115')).toBe(true)
  expect(await isPostcode('XX', '10115')).toBe(false)
  expect(await lookupPostcode('DE', '1011')).toBeNull()
  expect(await lookupPostcode('DE', '00000')).toBeNull()
})

it('Berlin to Munich is about 504 km', () => {
  const d = distanceKm({ lat: 52.52, lng: 13.405 }, { lat: 48.135, lng: 11.582 })
  expect(d).toBeGreaterThan(500)
  expect(d).toBeLessThan(510)
})
