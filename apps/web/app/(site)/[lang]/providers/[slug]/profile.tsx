import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { asUser, type Tx } from '@kando/db'
import type { ProviderDetail } from '@kando/contract'
import {
  getPublicProfile,
  listCategories,
  textsOf,
  translateTexts,
  TranslationUnavailable,
} from '@kando/domain'
import { formatPrice, t, type Key, type Lang } from '@kando/i18n'
import { TranslateLink } from './translate-link'
import { LangSwitch } from '../../../../../components/lang-switch'
import { alternates, langPath, pageLang } from '../../../../../lib/site'

// The provider page and its translated version (?translate=1, which the proxy sends to ./translated).
// Read under the anonymous RLS context: what an anonymous app user sees, nothing more.
export type Args = { params: Promise<{ lang: string; slug: string }> }
type Loaded = { profile: ProviderDetail; categoryNames: string[] }

async function read(tx: Tx, slug: string, lang: Lang): Promise<Loaded | null> {
  const profile = await getPublicProfile(tx, slug, lang)
  if (!profile) return null
  const names = new Map((await listCategories(tx, lang)).map((c) => [c.slug, c.name]))
  return { profile, categoryNames: profile.categories.map((s) => names.get(s) ?? s) }
}
// One transaction per render; the page and generateMetadata share it.
const load = cache((slug: string, lang: Lang) => asUser(null, (tx) => read(tx, slug, lang)))

export async function profileMetadata({ params }: Args, translate: boolean): Promise<Metadata> {
  const { slug } = await params
  const lang = await pageLang(params)
  const data = await load(slug, lang)
  if (!data) return {}
  const { profile } = data
  return {
    title: `${profile.publicName} | ${t(lang, 'brand.name')}`,
    // The AI version is not indexed; the canonical stays the original.
    robots: translate ? { index: false } : undefined,
    description: profile.bio
      ? Array.from(profile.bio.replace(/\s+/g, ' ').trim()).slice(0, 155).join('')
      : undefined,
    alternates: alternates(`/providers/${encodeURIComponent(slug)}`, lang),
  }
}

/** The profile with the translated texts put in (same order as `textsOf`). */
function withTexts(
  p: ProviderDetail,
  x: Awaited<ReturnType<typeof translateTexts>>,
): ProviderDetail {
  return {
    ...p,
    bio: x.bio,
    strengths: x.strengths,
    experience: x.experience,
    skills: x.skills,
    services: p.services.map((s, i) => ({
      ...s,
      title: x.services[i]!.title,
      description: x.services[i]!.description,
    })),
    references: p.references.map((r, i) => ({ ...r, description: x.references[i]!.description })),
  }
}

export async function renderProfile({ params }: Args, translate: boolean) {
  const { slug } = await params
  const lang = await pageLang(params)
  let data: Loaded | null
  let translated = false
  let unavailable = false
  if (translate) {
    // Stored translations only: the model is called by the button (TranslateLink), never by a page view.
    data = await asUser(null, async (tx) => {
      const d = await read(tx, slug, lang)
      if (!d?.profile.translatable) return d
      try {
        const texts = await translateTexts(tx, textsOf(d.profile), lang, '', true)
        translated = true
        return { ...d, profile: withTexts(d.profile, texts) }
      } catch (e) {
        if (!(e instanceof TranslationUnavailable)) throw e
        unavailable = true
        return d
      }
    })
  } else data = await load(slug, lang)
  if (!data) notFound()

  const { profile: p, categoryNames } = data
  const tt = (key: Key) => t(lang, key)
  // Stored one per line; shown as tags like the skills. Unique: a line typed twice would repeat.
  const strengths = [
    ...new Set(
      (p.strengths ?? '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ]
  const skills = p.skills ?? []
  const base = `/providers/${encodeURIComponent(slug)}`
  const h2 = 'mb-2 text-xl font-semibold'
  const tag = 'rounded border px-2 py-1 text-sm'

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-10">
      <LangSwitch lang={lang} path={base} />
      {p.translatable && !translated && (
        <p className="text-sm">
          <TranslateLink
            href={`${langPath(base, lang)}${langPath(base, lang).includes('?') ? '&' : '?'}translate=1`}
            apiPath={`/app-api/v1/providers/${encodeURIComponent(slug)}/translation?lang=${lang}`}
          >
            {tt('web.translate')}
          </TranslateLink>
          {unavailable && <span className="ml-2">{tt('web.translationUnavailable')}</span>}
        </p>
      )}
      {translated && (
        <p className="text-sm">
          <Link href={langPath(base, lang)}>
            {tt('web.translatedLabel')} · {tt('web.showOriginal')}
          </Link>
        </p>
      )}
      <header className="flex items-center gap-4">
        {p.photoUrl && (
          <img src={p.photoUrl} alt={p.publicName} className="size-24 rounded-full object-cover" />
        )}
        <div>
          {/* publicName is the business name or "Anna H." */}
          <h1 className="text-3xl font-bold">{p.publicName}</h1>
          {p.place && <p className="opacity-70">{p.place}</p>}
          <p className="opacity-70">{categoryNames.join(' · ')}</p>
          {p.rating && (
            <p className="text-sm">
              {t(lang, 'provider.rating', { average: p.rating.average.toLocaleString(lang), count: p.rating.count })}
            </p>
          )}
          {p.worksRemotely && <p className="text-sm">{tt('provider.remote')}</p>}
          {p.checkedDocuments.length > 0 && (
            <p className="text-sm">
              {tt('provider.checkedDocuments')}:{' '}
              {p.checkedDocuments.map((d) => tt(`doc.short.${d}` as Key)).join(', ')}
            </p>
          )}
        </div>
      </header>

      {p.bio && <p className="whitespace-pre-line">{p.bio}</p>}

      {strengths.length > 0 && (
        <section>
          <h2 className={h2}>{tt('provider.strengths')}</h2>
          <ul className="flex flex-wrap gap-2">
            {strengths.map((s) => (
              <li key={s} className={tag}>
                {s}
              </li>
            ))}
          </ul>
        </section>
      )}

      {skills.length > 0 && (
        <section>
          <h2 className={h2}>{tt('provider.skills')}</h2>
          <ul className="flex flex-wrap gap-2">
            {skills.map((s) => (
              <li key={s} className={tag}>
                {s}
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.experience && (
        <section>
          <h2 className={h2}>{tt('provider.experience')}</h2>
          <p className="whitespace-pre-line">{p.experience}</p>
        </section>
      )}

      {p.services.length > 0 && (
        <section>
          <h2 className={h2}>{tt('provider.services')}</h2>
          <ul className="space-y-3">
            {p.services.map((s) => (
              <li key={s.id} className="flex justify-between gap-4 border-b pb-2">
                <div>
                  <p className="font-medium">{s.title}</p>
                  {s.description && <p className="whitespace-pre-line text-sm">{s.description}</p>}
                </div>
                <p className="whitespace-nowrap">
                  {formatPrice(s.priceType, s.price, s.currency, lang)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.references.length > 0 && (
        <section>
          <h2 className={h2}>{tt('provider.references')}</h2>
          <ul className="space-y-2">
            {p.references.map((r) => (
              <li key={r.id}>
                <p className="font-medium">
                  {r.clientName}
                  {r.year ? ` (${r.year})` : ''}
                </p>
                <p className="whitespace-pre-line text-sm">{r.description}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(p.reviews?.length ?? 0) > 0 && (
        <section>
          <h2 className={h2}>{tt('provider.reviews')}</h2>
          <ul className="space-y-2">
            {p.reviews!.map((r, i) => (
              <li key={i}>
                <p className="font-medium">
                  {'★'.repeat(r.stars)}
                  {'☆'.repeat(5 - r.stars)} · {new Date(r.date).toLocaleDateString(lang)}
                </p>
                {r.text && <p className="whitespace-pre-line text-sm">{r.text}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.photos.length > 0 && (
        <section>
          <h2 className={h2}>{tt('provider.portfolio')}</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {p.photos.map(
              (ph) =>
                ph.url && (
                  <li key={ph.id}>
                    <img
                      src={ph.url}
                      alt={ph.alt ?? ''}
                      className="aspect-square w-full rounded object-cover"
                    />
                  </li>
                ),
            )}
          </ul>
        </section>
      )}

      {p.providerType === 'business' && p.impressum && (
        <section>
          <h2 className={h2}>{tt('provider.impressum')}</h2>
          <p className="whitespace-pre-line text-sm">{p.impressum}</p>
        </section>
      )}

      <section className="rounded border p-4">
        <h2 className={h2}>{tt('web.getApp')}</h2>
        <p className="mb-2">{t(lang, 'web.getAppText')}</p>
        {/* The store links do not exist until the app is published. */}
        <Link href={langPath('/', lang)} className="underline">
          {tt('web.getApp')}
        </Link>
      </section>
    </main>
  )
}
