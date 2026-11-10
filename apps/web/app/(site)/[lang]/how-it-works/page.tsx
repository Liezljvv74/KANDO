import type { Metadata } from 'next'
import Link from 'next/link'
import { t, type Key, type Lang } from '@kando/i18n'
import { LangSwitch } from '@/components/lang-switch'
import { alternates, langPath, pageLang } from '@/lib/site'

type Args = { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const lang = await pageLang(params)
  return { title: `${t(lang, 'welcome.howTitle')} - ${t(lang, 'brand.name')}`, alternates: alternates('/how-it-works', lang) }
}

// The same content as the app's "How it works" screen.
const GROUPS: { title: Key; steps: [Key, Key, Key]; bg: string }[] = [
  { title: 'home.customerTitle', steps: ['home.customer1', 'home.customer2', 'home.customer3'], bg: 'bg-mint-200' },
  { title: 'home.providerTitle', steps: ['home.provider1', 'home.provider2', 'home.provider3'], bg: 'bg-white' },
]
const SAFETY: [Key, Key][] = [
  ['home.payment', 'howto.paymentText'],
  ['home.safetyVerified', 'howto.verifiedText'],
  ['howto.reviewsTitle', 'home.safetyReviewsText'],
  ['home.safetyEu', 'home.safetyEuText'],
]

export default async function HowItWorksPage({ params }: Args) {
  const lang: Lang = await pageLang(params)
  const tt = (key: Key) => t(lang, key, { brand: t(lang, 'brand.name') })
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between">
        <Link href={langPath('/', lang)} className="font-semibold text-brand underline">
          ← {tt('welcome.backHome')}
        </Link>
        <LangSwitch lang={lang} path="/how-it-works" />
      </div>
      <h1 className="mt-6 text-4xl font-black">{tt('welcome.howTitle')}</h1>
      <div className="mt-6 grid gap-4">
        {GROUPS.map(({ title, steps, bg }) => (
          <div key={title} className={`rounded-md border-2 border-dashed border-brand p-5 ${bg}`}>
            <h2 className="text-xl font-bold">{tt(title)}</h2>
            <ol className="mt-3 space-y-2">
              {steps.map((s, i) => (
                <li key={s}>
                  {i + 1}. {tt(s)}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <h2 className="mt-10 text-3xl font-black">{tt('home.safetyTitle')}</h2>
      <div className="mt-4 grid gap-5">
        {SAFETY.map(([title, text]) => (
          <div key={title}>
            <h3 className="text-lg font-bold">{tt(title)}</h3>
            <p className="mt-1 leading-relaxed">{tt(text)}</p>
          </div>
        ))}
      </div>
      <div className="mt-10">
        <Link href={`${langPath('/', lang)}#install`} className="inline-block rounded-md bg-teal px-5 py-3 text-base font-bold text-ink">
          {tt('home.install')}
        </Link>
      </div>
    </main>
  )
}
