import { sql } from 'drizzle-orm'
import { lookupPostcode, type Tx } from '@kando/db'
import type { ProviderDetail } from '@kando/contract'
import { offerableServiceIds } from './providers/eligibility'
import type { Lang } from '@kando/i18n'
import { photoUrl } from './storage'
import { needsTranslation, textsOf } from './translate'

type Row = {
  id: string
  slug: string
  public_name: string
  type: string
  business_name: string | null
  impressum: string | null
  bio: string | null
  strengths: string | null
  skills: string[]
  experience: string | null
  works_remotely: boolean
  country: string
  base_postcode: string | null
  photo_key: string | null
}

/**
 * A published, non-suspended provider with at least one offerable service, by slug; public fields only
 * (never owner, postcode or suspension). Everything runs in the request's `tx`; eligibility is a SECURITY DEFINER SQL function.
 * `translatable`: the page texts are not in `lang`, so the translate button shows.
 */
export async function getPublicProfile(tx: Tx, slug: string, lang: Lang): Promise<ProviderDetail | null> {
  const { rows } = await tx.execute<Row>(sql`
    SELECT p.id, p.slug, p.public_name, p.type, p.business_name, p.impressum, p.bio, p.strengths, p.skills,
           p.experience, p.works_remotely, p.country, p.base_postcode, ph.key AS photo_key
    FROM providers p LEFT JOIN photos ph ON ph.owner_id = p.owner_id AND ph.kind = 'profile' -- the person's picture
    WHERE p.slug = ${slug} AND p.status = 'published' AND (p.suspended_until IS NULL OR p.suspended_until <= now())`)
  const p = rows[0]
  if (!p) return null
  const ids = await offerableServiceIds(tx, p.id)
  if (!ids.length) return null // same rule as search: no page until a service may be offered

  const [services, references, photos, place] = await Promise.all([
    tx.execute<{ id: string; category: string; title: string; description: string | null; price_type: string; price: string | null; currency: string }>(sql`
      SELECT s.id, c.slug AS category, s.title, s.description, s.price_type, s.price, s.currency FROM services s JOIN categories c ON c.id = s.category_id
      WHERE s.provider_id = ${p.id} AND s.id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      ORDER BY s.sort, s.created_at, s.id`),
    tx.execute<{ id: string; client_name: string; description: string; year: number | null }>(sql`
      SELECT id, client_name, description, year FROM provider_references WHERE provider_id = ${p.id}
      ORDER BY year DESC NULLS LAST, created_at DESC, id`),
    tx.execute<{ id: string; key: string; alt: string | null }>(sql`
      SELECT id, key, alt FROM photos WHERE provider_id = ${p.id} AND kind = 'portfolio' ORDER BY sort, created_at, id`),
    p.base_postcode ? lookupPostcode(p.country, p.base_postcode, tx) : null,
  ])

  const detail: ProviderDetail = {
    slug: p.slug,
    publicName: p.public_name,
    providerType: p.type,
    businessName: p.business_name,
    impressum: p.impressum,
    bio: p.bio,
    strengths: p.strengths,
    skills: p.skills,
    experience: p.experience,
    worksRemotely: p.works_remotely,
    photoUrl: p.photo_key ? photoUrl(p.photo_key) : null,
    place: place?.place ?? null,
    categories: [...new Set(services.rows.map((s) => s.category))],
    services: services.rows.map((s) => ({
      id: s.id,
      category: s.category,
      title: s.title,
      description: s.description,
      priceType: s.price_type as 'fixed' | 'hourly' | 'from' | 'on-request',
      price: s.price === null ? null : Number(s.price),
      currency: s.currency as ProviderDetail['services'][number]['currency'],
    })),
    references: references.rows.map((r) => ({ id: r.id, clientName: r.client_name, description: r.description, year: r.year })),
    // Without a description of its own, a photo is described by the current public name (it follows renames).
    photos: photos.rows.map((ph) => ({ id: ph.id, url: photoUrl(ph.key), alt: ph.alt || p.public_name })),
    isNew: true, // Until ratings exist (Stage 6).
    translatable: false,
  }
  detail.translatable = needsTranslation(textsOf(detail), lang)
  return detail
}
