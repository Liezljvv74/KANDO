import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { eq, sql } from 'drizzle-orm'
import { db, type Tx } from './client'
import { countries } from './schema'

export type PostcodeHit = { code: string; place: string; state: string; lat: number; lng: number }

/** Postcodes and countries are public reference tables: pass the request's `tx` so no second connection is needed. */
export type Executor = Tx | typeof db

export async function isPostcode(country: string, code: string, exec: Executor = db): Promise<boolean> {
  const [row] = await exec.select({ p: countries.postcodePattern }).from(countries).where(eq(countries.code, country))
  return !!row && new RegExp(row.p).test(code)
}

export async function lookupPostcode(country: string, code: string, exec: Executor = db): Promise<PostcodeHit | null> {
  if (!(await isPostcode(country, code, exec))) return null
  const { rows } = await exec.execute<PostcodeHit>(sql`
    SELECT code, place, state, ST_Y(location) AS lat, ST_X(location) AS lng
    FROM postcodes WHERE country = ${country} AND code = ${code}`)
  return rows[0] ?? null
}

/** Great-circle (haversine) distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/** Upserts a TSV (header, then code place state lat lng) in batches; returns the row count. */
export async function importPostcodes(country: 'DE', file: string): Promise<number> {
  let n = 0
  let batch: string[][] = []
  const flush = async () => {
    if (!batch.length) return
    const values = batch.map(([code, place, state, lat, lng]) =>
      sql`(${country}, ${code}, ${place}, ${state}, ST_SetSRID(ST_MakePoint(${Number(lng)}, ${Number(lat)}), 4326))`)
    await db.execute(sql`
      INSERT INTO postcodes (country, code, place, state, location) VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (country, code) DO UPDATE SET place = excluded.place, state = excluded.state, location = excluded.location`)
    n += batch.length
    batch = []
  }
  let header = true
  for await (const line of createInterface({ input: createReadStream(file, 'utf8') })) {
    if (header) { header = false; continue }
    if (!line) continue
    batch.push(line.split('\t'))
    if (batch.length === 1000) await flush()
  }
  await flush()
  return n
}
