import { sql } from 'drizzle-orm'
import { distanceKm, lookupPostcode, type Tx } from '@kando/db'
import type { SearchItem, SearchResult } from '@kando/contract'
import { fail } from './providers/http'
import { photoUrl } from './storage'

export const PAGE_SIZE = 20
export const MAX_CANDIDATES = 500
export const MAX_DISTANCE_M = 200_000

type Candidate = {
  id: string
  slug: string
  display_name: string
  public_name: string
  photo_key: string | null
  lat: number | null
  lng: number | null
  service_radius_km: number
  works_remotely: boolean
}

const like = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`

/**
 * Visible providers: published, not suspended, with at least one offerable service, all decided in the candidate SQL.
 * Everything runs in the request's `tx`: eligibility is the SECURITY DEFINER function `offerable_service_ids`
 * (documents are private), and postcodes are public reference data.
 */
export async function search(
  tx: Tx,
  { category, postcode, q, page = 1, lang, country = 'DE' }: { category?: string; postcode?: string; q?: string; page?: number; lang: string; country?: string },
): Promise<SearchResult> {
  const known = (await tx.execute(sql`SELECT 1 FROM countries WHERE code = ${country}`)).rows.length > 0
  if (!known) return fail(400, { error: 'Unknown country' })
  const cat = category ? (await tx.execute<{ id: string }>(sql`SELECT id FROM categories WHERE slug = ${category}`)).rows[0] : undefined
  if (category && !cat) return fail(400, { error: 'Unknown category' })
  const origin = postcode ? await lookupPostcode(country, postcode, tx) : null
  if (postcode && !origin) return fail(400, { error: 'Unknown postcode' })
  const term = q?.trim()

  const here = origin ? sql`ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography` : sql``
  // On-site providers must be within their own radius (plus 1 % for sphere vs spheroid; the exact check is haversine below),
  // so the 500 cap applies after the radius. Remote providers are always in.
  const near = origin
    ? sql`AND (p.works_remotely OR ST_DWithin(p.location::geography, ${here}, LEAST(p.service_radius_km * 1010, ${MAX_DISTANCE_M})))`
    : sql``
  const offerable = cat
    ? sql`EXISTS (SELECT 1 FROM services s WHERE s.provider_id = p.id AND s.category_id = ${cat.id} AND s.id IN (SELECT offerable_service_ids(p.id)))`
    : sql`EXISTS (SELECT 1 FROM offerable_service_ids(p.id))`
  const { rows } = await tx.execute<Candidate>(sql`
    SELECT p.id, p.slug, p.display_name, p.public_name, ph.key AS photo_key, ST_Y(p.location) AS lat, ST_X(p.location) AS lng,
           p.service_radius_km, p.works_remotely
    FROM providers p
    LEFT JOIN photos ph ON ph.id = p.photo_id
    WHERE p.status = 'published' AND p.suspended = false AND p.country = ${country} AND p.slug IS NOT NULL
      AND ${offerable}
      ${near}
      ${term ? sql`AND (p.public_name ILIKE ${like(term)} OR EXISTS (SELECT 1 FROM unnest(p.skills) k WHERE k ILIKE ${like(term)}))` : sql``}
    ORDER BY ${origin ? sql`ST_Distance(p.location::geography, ${here}),` : sql``} p.public_name, p.id
    LIMIT ${MAX_CANDIDATES}`)

  const ranked = rows
    .flatMap((p) => {
      const d = origin && p.lat != null && p.lng != null ? distanceKm(origin, { lat: p.lat, lng: p.lng }) : null
      const inRadius = d != null && d <= p.service_radius_km + 1e-6 // 1 mm of float slack at exactly the radius
      if (origin && !p.works_remotely && !inRadius) return [] // on-site work only within the provider's own radius
      // Outside the radius (a remote match) the distance stays hidden: exact distances from many postcodes would reveal the base.
      return [{ p, distance: inRadius ? d : null }]
    })
    .sort(
      (a, b) =>
        (a.distance ?? Infinity) - (b.distance ?? Infinity) ||
        a.p.public_name.localeCompare(b.p.public_name, lang) ||
        a.p.id.localeCompare(b.p.id),
    )
  const pageRows = ranked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // One query for the page: each provider's offerable services (price, category slug).
  const svc = pageRows.length
    ? (
        await tx.execute<{ provider_id: string; price: string | null; slug: string; category_id: string }>(sql`
          SELECT s.provider_id, s.price, c.slug, c.id AS category_id FROM services s JOIN categories c ON c.id = s.category_id
          WHERE s.provider_id IN (${sql.join(pageRows.map(({ p }) => sql`${p.id}::uuid`), sql`, `)})
            AND s.id IN (SELECT offerable_service_ids(s.provider_id))`)
      ).rows
    : []

  const items: SearchItem[] = pageRows.map(({ p, distance }) => {
    const own = svc.filter((s) => s.provider_id === p.id)
    const counted = cat ? own.filter((s) => s.category_id === cat.id) : own
    const prices = counted.flatMap((s) => (s.price === null ? [] : [Number(s.price)]))
    return {
      slug: p.slug,
      displayName: p.display_name,
      publicName: p.public_name,
      photoUrl: p.photo_key ? photoUrl(p.photo_key) : null,
      categories: [...new Set(own.map((s) => s.slug))],
      fromPrice: prices.length ? Math.min(...prices) : null,
      // Whole km, at least 1: coarse enough not to pinpoint the base postcode.
      distanceKm: distance == null ? null : Math.max(1, Math.round(distance)),
      worksRemotely: p.works_remotely,
      currency: 'EUR',
      isNew: true, // Until ratings exist (Stage 6).
    }
  })
  return { items, page, hasMore: ranked.length > page * PAGE_SIZE }
}
