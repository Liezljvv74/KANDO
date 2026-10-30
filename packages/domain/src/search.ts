import { sql } from 'drizzle-orm'
import { lookupPostcode, notSuspendedSql, type Tx } from '@kando/db'
import type { SearchItem, SearchResult } from '@kando/contract'
import { fail } from './providers/http'
import { ratingsOf } from './reviews'
import { photoUrl } from './storage'

export const PAGE_SIZE = 20
export const MAX_DISTANCE_M = 200_000

type Row = {
  id: string
  owner_id: string
  slug: string
  public_name: string
  photo_key: string | null
  works_remotely: boolean
  km: number | null
}

const like = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`

/**
 * Visible providers (published, not suspended, at least one offerable service), the radius rule and the order all run in
 * SQL, one page at a time. Everything runs in the request's `tx`: `services.offerable` is the triggers' cached eligibility
 * (rls.ts), readable under RLS; postcodes and visible reviews are public.
 */
export async function search(
  tx: Tx,
  {
    category,
    postcode,
    q,
    page = 1,
    country,
  }: {
    category?: string
    postcode?: string
    q?: string
    page?: number
    country?: string
  },
): Promise<SearchResult> {
  country ??= await marketCountry(tx)
  const market = (await tx.execute<{ currency: string }>(sql`SELECT currency FROM countries WHERE code = ${country}`)).rows[0]
  if (!market) return fail(400, { error: 'Unknown country' })
  const cat = category
    ? (await tx.execute<{ id: string }>(sql`SELECT id FROM categories WHERE slug = ${category}`))
        .rows[0]
    : undefined
  if (category && !cat) return fail(400, { error: 'Unknown category' })
  const origin = postcode ? await lookupPostcode(country, postcode, tx) : null
  if (postcode && !origin) return fail(400, { error: 'Unknown postcode' })
  const term = q?.trim()

  // The distance within the provider's own radius (1 mm of float slack at exactly the radius), else NULL: outside the
  // radius (a remote match) the distance stays hidden, since exact distances from many postcodes would reveal the base.
  // Haversine, R = 6371 km: the same formula and operation order as distanceKm (packages/db/src/postcodes.ts).
  const km = origin
    ? sql`(SELECT CASE WHEN h.d <= p.service_radius_km + 1e-6 THEN h.d END FROM (SELECT 2 * 6371 * asin(sqrt(
        power(sin(radians(ST_Y(p.location) - ${origin.lat}::float8) / 2), 2)
        + cos(radians(${origin.lat}::float8)) * cos(radians(ST_Y(p.location))) * power(sin(radians(ST_X(p.location) - ${origin.lng}::float8) / 2), 2)
      )) AS d) h)`
    : sql`NULL::float8`
  // On-site work only within the provider's own radius; remote providers are always in. The ST_DWithin prefilter (sphere
  // vs spheroid: plus 1 %) keeps the expression of the providers_location_gist index; the exact check is the haversine.
  const near = origin
    ? sql`AND (p.works_remotely OR (ST_DWithin(p.location::geography, ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography, LEAST(p.service_radius_km * 1010, ${MAX_DISTANCE_M})) AND d.km IS NOT NULL))`
    : sql``
  const { rows } = await tx.execute<Row>(sql`
    SELECT p.id, p.owner_id, p.slug, p.public_name, ph.key AS photo_key, p.works_remotely, d.km
    FROM providers p
    LEFT JOIN photos ph ON ph.owner_id = p.owner_id AND ph.kind = 'profile' -- the person's picture
    CROSS JOIN LATERAL (SELECT ${km} AS km) d
    WHERE p.status = 'published' AND ${notSuspendedSql('p')} AND p.country = ${country} AND p.slug IS NOT NULL
      AND EXISTS (SELECT 1 FROM services s WHERE s.provider_id = p.id AND s.offerable ${cat ? sql`AND s.category_id = ${cat.id}` : sql``})
      ${near}
      ${term ? sql`AND (p.public_name ILIKE ${like(term)} OR EXISTS (SELECT 1 FROM unnest(p.skills) k WHERE k ILIKE ${like(term)}))` : sql``}
    ORDER BY d.km NULLS LAST, lower(p.public_name), p.id
    LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}`)
  const pageRows = rows.slice(0, PAGE_SIZE)

  // One query for the page: each provider's offerable services (price, category slug).
  const svc = pageRows.length
    ? (
        await tx.execute<{
          provider_id: string
          price: string | null
          currency: string
          slug: string
          category_id: string
        }>(sql`
          SELECT s.provider_id, s.price, s.currency, c.slug, c.id AS category_id FROM services s JOIN categories c ON c.id = s.category_id
          WHERE s.offerable AND s.provider_id IN (${sql.join(
            pageRows.map((p) => sql`${p.id}::uuid`),
            sql`, `,
          )})`)
      ).rows
    : []
  const ratings = await ratingsOf(tx, pageRows.map((p) => p.owner_id), 'customer') // shown reviews only

  const items: SearchItem[] = pageRows.map((p) => {
    const own = svc.filter((s) => s.provider_id === p.id)
    const counted = cat ? own.filter((s) => s.category_id === cat.id) : own
    const priced = counted.filter((s) => s.price !== null).sort((a, b) => Number(a.price) - Number(b.price))
    const rating = ratings.get(p.owner_id) ?? null
    return {
      slug: p.slug,
      publicName: p.public_name,
      photoUrl: p.photo_key ? photoUrl(p.photo_key) : null,
      categories: [...new Set(own.map((s) => s.slug))],
      fromPrice: priced.length ? Number(priced[0]!.price) : null,
      // Whole km, at least 1: coarse enough not to pinpoint the base postcode.
      distanceKm: p.km == null ? null : Math.max(1, Math.round(Number(p.km))),
      worksRemotely: p.works_remotely,
      // The currency of the cheapest service, else of any shown one (the country's if they vanished between the two queries).
      currency: ((priced[0] ?? own[0])?.currency ?? market.currency) as SearchItem['currency'],
      rating,
      isNew: rating === null,
    }
  })
  return { items, page, hasMore: rows.length > PAGE_SIZE }
}

/** The only market, when there is exactly one; with several the caller must name one. */
export async function marketCountry(tx: Tx): Promise<string> {
  const { rows } = await tx.execute<{ code: string }>(sql`SELECT code FROM countries LIMIT 2`)
  if (rows.length !== 1) return fail(400, { error: 'country-required' })
  return rows[0]!.code
}

/** Slugs (and last change) of the providers the search shows, in every market: the same visibility rule, for the sitemap. */
export async function visibleProviderSlugs(
  tx: Tx,
): Promise<{ slug: string; updatedAt: Date }[]> {
  const { rows } = await tx.execute<{ slug: string; updated_at: Date | string }>(sql`
    SELECT p.slug, p.updated_at FROM providers p
    WHERE p.status = 'published' AND ${notSuspendedSql('p')} AND p.slug IS NOT NULL
      AND EXISTS (SELECT 1 FROM services s WHERE s.provider_id = p.id AND s.offerable)
    ORDER BY p.slug LIMIT ${MAX_SITEMAP_PROVIDERS}`)
  return rows.map((r) => ({ slug: r.slug, updatedAt: new Date(r.updated_at) }))
}
const MAX_SITEMAP_PROVIDERS = 5000 // ponytail: one sitemap file holds 50,000 urls; split into an index beyond that
