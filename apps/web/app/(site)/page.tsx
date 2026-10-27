import type { Metadata } from 'next'
import { asUser } from '@kando/db'
import { listCategories } from '@kando/domain'
import { t, type Key, type Lang } from '@kando/i18n'
import { LangSwitch } from '../../components/lang-switch'
import { alternates, siteLang } from '../../lib/site'

type Args = { searchParams: Promise<{ lang?: string }> }

export async function generateMetadata({ searchParams }: Args): Promise<Metadata> {
  const lang = siteLang((await searchParams).lang)
  return {
    title: t(lang, 'home.metaTitle'),
    description: t(lang, 'home.metaDescription'),
    alternates: alternates('/', lang),
  }
}

// The store links do not exist until the app is published.
function StoreButtons({ lang, inverted }: { lang: Lang; inverted?: boolean }) {
  const cls = inverted ? 'bg-white text-brand' : 'bg-brand text-white'
  return (
    <div className="flex flex-wrap gap-3">
      {['App Store', 'Google Play'].map((store) => (
        <span
          key={store}
          className={`${cls} rounded-xl px-4 py-2.5 text-sm font-semibold`}
          title={t(lang, 'home.soon')}
        >
          {store} · {t(lang, 'home.soon')}
        </span>
      ))}
    </div>
  )
}

const BADGES: [Key, Key][] = [
  ['home.badgeVerified', 'home.badgeVerifiedText'],
  ['home.payment', 'home.paymentBadgeText'],
  ['home.badgeNoFees', 'home.badgeNoFeesText'],
]
const SAFETY: [Key, Key][] = [
  ['home.payment', 'home.paymentText'],
  ['home.safetyVerified', 'home.safetyVerifiedText'],
  ['home.safetyReviews', 'home.safetyReviewsText'],
  ['home.safetyEu', 'home.safetyEuText'],
]
const STEPS: Record<'customer' | 'provider', [Key, Key, Key, Key]> = {
  customer: ['home.customerTitle', 'home.customer1', 'home.customer2', 'home.customer3'],
  provider: ['home.providerTitle', 'home.provider1', 'home.provider2', 'home.provider3'],
}

export default async function HomePage({ searchParams }: Args) {
  const lang = siteLang((await searchParams).lang)
  const categories = await asUser(null, (tx) => listCategories(tx, lang))
  const tt = (key: Key) => t(lang, key)

  return (
    <main>
      <section className="bg-mint-50">
        <div className="mx-auto max-w-5xl px-4 py-12">
          <div className="flex justify-end">
            <LangSwitch lang={lang} path="/" />
          </div>
          <h1 className="mt-6 text-4xl font-extrabold leading-tight md:text-5xl">
            {tt('home.headline')}
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed">{tt('home.intro')}</p>
          <div className="mt-6">
            <StoreButtons lang={lang} />
          </div>
          <div className="mt-10 grid gap-3 text-sm sm:grid-cols-3">
            {BADGES.map(([title, text]) => (
              <div key={title} className="rounded-2xl border border-mint-200 bg-white p-4">
                <b>{tt(title)}</b>
                <br />
                {tt(text)}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-5xl px-4 py-12">
          <h2 className="text-3xl font-extrabold">{tt('home.howTitle')}</h2>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {(Object.keys(STEPS) as (keyof typeof STEPS)[]).map((who) => {
              const [title, ...steps] = STEPS[who]
              return (
                <div
                  key={who}
                  className={`rounded-2xl p-6 ${who === 'customer' ? 'bg-mint-50' : 'bg-sand'}`}
                >
                  <h3 className="text-xl font-bold">{tt(title)}</h3>
                  <ol className="mt-3 list-decimal space-y-2 pl-5">
                    {steps.map((s) => (
                      <li key={s}>{tt(s)}</li>
                    ))}
                  </ol>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="bg-mint-50">
        <div className="mx-auto max-w-5xl px-4 py-12">
          <h2 className="mb-4 text-3xl font-extrabold">{tt('home.categoriesTitle')}</h2>
          <ul className="flex flex-wrap gap-3">
            {categories.map((c) => (
              <li
                key={c.id}
                className="rounded-full border border-mint-200 bg-white px-4 py-2 font-semibold"
              >
                {c.name}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-5xl px-4 py-12">
          <h2 className="text-3xl font-extrabold">{tt('home.safetyTitle')}</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {SAFETY.map(([title, text]) => (
              <div key={title}>
                <h3 className="font-bold">{tt(title)}</h3>
                <p className="mt-1 leading-relaxed">{tt(text)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-sand">
        <div className="mx-auto max-w-5xl px-4 py-12">
          <h2 className="text-3xl font-extrabold">{tt('home.providersTitle')}</h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed">{tt('home.providersText')}</p>
        </div>
      </section>

      <section className="bg-brand text-white">
        <div className="mx-auto max-w-5xl px-4 py-14 text-center">
          <h2 className="text-3xl font-extrabold">{tt('home.ctaTitle')}</h2>
          <p className="mt-2 opacity-90">{tt('home.ctaText')}</p>
          <div className="mt-6 flex justify-center">
            <StoreButtons lang={lang} inverted />
          </div>
        </div>
      </section>
    </main>
  )
}
