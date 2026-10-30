import { sql } from 'drizzle-orm'
import { lookupPostcode, notSuspendedSql, type Tx } from '@kando/db'
import { DOCUMENT_TYPES, type ProviderDetail } from '@kando/contract'
import { offerableServiceIds } from './providers/eligibility'
import { canTransact, paymentsEnabled } from './payments/rules'
import type { Lang } from '@kando/i18n'
import { photoUrl } from './storage'
import { needsTranslation, textsOf } from './translate'
import { latestReviews, ratingsOf } from './reviews'

type Row = {
  id: string
  owner_id: string
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
  payouts_ready_at: Date | string | null
  invoice_consent_at: Date | string | null
  legal_status: string | null
  vat_id: string | null
  tax_number: string | null
}

/**
 * A published, non-suspended provider with at least one offerable service, by slug; public fields only
 * (never owner, postcode, suspension or payment data: payout readiness only as the `verified` and `canBook` flags). Everything runs in the request's `tx`; eligibility is a SECURITY DEFINER SQL function.
 * `translatable`: the page texts are not in `lang`, so the translate button shows.
 */
export async function getPublicProfile(tx: Tx, slug: string, lang: Lang): Promise<ProviderDetail | null> {
  const { rows } = await tx.execute<Row>(sql`
    SELECT p.id, p.owner_id, p.slug, p.public_name, p.type, p.business_name, p.impressum, p.bio, p.strengths, p.skills,
           p.experience, p.works_remotely, p.country, p.base_postcode, ph.key AS photo_key, p.payouts_ready_at,
           p.invoice_consent_at, p.legal_status, p.vat_id, p.tax_number
    FROM providers p LEFT JOIN photos ph ON ph.owner_id = p.owner_id AND ph.kind = 'profile' -- the person's picture
    WHERE p.slug = ${slug} AND p.status = 'published' AND ${notSuspendedSql('p')}`)
  const p = rows[0]
  if (!p) return null
  const ids = await offerableServiceIds(tx, p.id)
  if (!ids.length) return null // same rule as search: no page until a service may be offered

  // one after another: one request transaction is one connection, and pg queues (and pg 9 refuses) parallel queries on it
  const services = await tx.execute<{ id: string; category: string; title: string; description: string | null; price_type: string; price: string | null; currency: string }>(sql`
    SELECT s.id, c.slug AS category, s.title, s.description, s.price_type, s.price, s.currency FROM services s JOIN categories c ON c.id = s.category_id
    WHERE s.provider_id = ${p.id} AND s.id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
    ORDER BY s.sort, s.created_at, s.id`)
  const references = await tx.execute<{ id: string; client_name: string; description: string; year: number | null }>(sql`
    SELECT id, client_name, description, year FROM provider_references WHERE provider_id = ${p.id}
    ORDER BY year DESC NULLS LAST, created_at DESC, id`)
  const photos = await tx.execute<{ id: string; key: string; alt: string | null }>(sql`
    SELECT id, key, alt FROM photos WHERE provider_id = ${p.id} AND kind = 'portfolio' ORDER BY sort, created_at, id`)
  const place = p.base_postcode ? await lookupPostcode(p.country, p.base_postcode, tx) : null
  const checked = await tx.execute<{ docs: string[] }>(sql`SELECT public_checked_documents(${p.id}) AS docs`) // SECURITY DEFINER: type keys only
  const reliability = await tx.execute<{ n: number }>(sql`SELECT provider_reliability(${p.id}) AS n`) // SECURITY DEFINER: a count only
  const ratings = await ratingsOf(tx, [p.owner_id], 'customer') // shown reviews only (RLS and the filter agree)
  const reviews = await latestReviews(tx, p.owner_id)
  // Row security shows only the caller's own watches, and an anonymous caller has none: the flag never reaches a cached site page.
  const watch = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM availability_watches WHERE provider_id = ${p.id} AND notified_at IS NULL`)
  const approved = new Set(checked.rows[0]?.docs ?? [])
  const rating = ratings.get(p.owner_id) ?? null

  const detail: ProviderDetail = {
    providerId: p.id,
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
    checkedDocuments: DOCUMENT_TYPES.filter((d) => approved.has(d)),
    isNew: rating === null,
    reliability: Number(reliability.rows[0]?.n ?? 0),
    rating,
    reviews,
    verified: paymentsEnabled() && p.payouts_ready_at !== null, // payout set-up done (Stripe checked identity); means nothing while payments are off
    canBook: canTransact({
      payoutsReadyAt: p.payouts_ready_at === null ? null : new Date(p.payouts_ready_at),
      invoiceConsentAt: p.invoice_consent_at === null ? null : new Date(p.invoice_consent_at),
      legalStatus: p.legal_status,
      vatId: p.vat_id,
      taxNumber: p.tax_number,
    }),
    watching: Number(watch.rows[0]?.n ?? 0) > 0,
    translatable: false,
  }
  detail.translatable = needsTranslation(textsOf(detail), lang)
  return detail
}
