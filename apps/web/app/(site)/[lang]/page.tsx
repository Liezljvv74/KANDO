import type { Metadata } from 'next'
import Link from 'next/link'
import { asUser } from '@kando/db'
import { listCategories } from '@kando/domain'
import { t, type Key, type Lang } from '@kando/i18n'
import { LangSwitch } from '@/components/lang-switch'
import { alternates, langPath, pageLang } from '@/lib/site'

type Args = { params: Promise<{ lang: string }> }

// Cached; a category change refreshes it at once (public-cache.ts).
export const revalidate = 3600

export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const lang = await pageLang(params)
  return {
    title: t(lang, 'home.metaTitle'),
    description: t(lang, 'home.metaDescription'),
    alternates: alternates('/', lang),
  }
}

// No store listing yet: both install buttons download the Android app from our own address (app/KANDO.apk/route.ts) and look the same (one style, two sizes).
const BUTTON_LOOK =
  'inline-flex items-center gap-1.5 rounded-md bg-teal font-bold text-ink shadow-[0_3px_0_var(--color-teal-deep)] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0.5 active:shadow-none'

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3v10m0 0-4-4m4 4 4-4M4 17h12" />
    </svg>
  )
}

function InstallButton({ lang }: { lang: Lang }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <a href="/KANDO.apk" download="KANDO.apk" className={`${BUTTON_LOOK} h-11 px-5 text-base`}>
        <DownloadIcon />
        {t(lang, 'home.install')}
      </a>
      <p className="text-sm">{t(lang, 'home.androidOnly')}</p>
    </div>
  )
}

/** "Finally\nSomeone who CAN" -> ["FINALLY", "Someone who CAN"]: the first word in capitals and mint, the rest in teal (as on the app's Home). */
const splitHeadline = (s: string): [string, string] => {
  const i = s.indexOf('\n')
  return i < 0 ? [s.toUpperCase(), ''] : [s.slice(0, i).toUpperCase(), s.slice(i + 1)]
}

// The app's three Home choices, with the app's colours: the first two lead to Install, the third to How it works.
const CHOICES: { title: Key; text: Key; to: 'install' | 'how'; style: string }[] = [
  { title: 'welcome.browse', text: 'welcome.browseText', to: 'install', style: 'border-teal bg-mint-50' },
  { title: 'welcome.offer', text: 'welcome.offerText', to: 'install', style: 'border-brand bg-white' },
  { title: 'welcome.learn', text: 'welcome.learnText', to: 'how', style: 'border-teal bg-[#d3f3f0]' },
]

export default async function HomePage({ params }: Args) {
  const lang = await pageLang(params)
  const categories = await asUser(null, (tx) => listCategories(tx, lang))
  const tt = (key: Key) => t(lang, key)
  const head = splitHeadline(tt('home.heroHeadline'))

  return (
    <main>
      <section className="bg-brand text-white">
        <div className="mx-auto max-w-3xl px-4 py-10">
          <div className="flex justify-end">
            <LangSwitch lang={lang} path="/" />
          </div>
          <h1 className="mt-4 whitespace-pre-line text-5xl font-black leading-[1.05] md:text-6xl">
            <span className="text-mint-50">{head[0]}</span>
            {'\n'}
            <span className="text-teal">{head[1]}</span>
          </h1>
          {/* One row, both 32 px high (the stamp: 20 px line + 8 px padding + 4 px border): the stamp on the left, the install button on the right. The button downloads the Android file, so the Android-only note stands right under it. */}
          <div className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <p className="font-tag -rotate-2 border-2 border-teal px-3 py-1 text-sm tracking-wider text-teal">{tt('home.stamp')}</p>
              <a
                href="/KANDO.apk"
                download="KANDO.apk"
                className={`${BUTTON_LOOK} get-app-nudge relative h-8 px-3 text-sm after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']`}
              >
                <DownloadIcon />
                {tt('home.getApp')}
              </a>
            </div>
            <p className="ml-auto mt-3 max-w-[15rem] text-right text-sm text-on-indigo-muted">{tt('home.androidOnly')}</p>
          </div>
          <div className="mt-6 grid gap-3">
            {CHOICES.map(({ title, text, to, style }) => (
              <Link
                key={title}
                href={to === 'install' ? '#install' : langPath('/how-it-works', lang)}
                className={`block rounded-md border-2 p-4 text-ink hover:opacity-90 ${style}`}
              >
                <span className="flex justify-between text-xl font-bold" style={{ fontFamily: 'var(--font-heading), Georgia, serif' }}>
                  <span>{tt(title)}</span>
                  <span aria-hidden="true">→</span>
                </span>
                <span className="mt-1 block text-base leading-snug text-ink-muted">{t(lang, text, { brand: tt('brand.name') })}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-4 py-10">
          <h2 className="mb-4 text-3xl font-black">{tt('home.categoriesTitle')}</h2>
          <ul className="flex flex-wrap gap-3">
            {categories.map((c) => (
              <li key={c.id} className="font-tag rounded-md border-2 border-dashed border-brand bg-white px-4 py-2 font-bold text-brand">
                {c.name}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="install" className="bg-brand text-white">
        <div className="mx-auto max-w-3xl px-4 py-12">
          <h2 className="text-3xl font-black">{tt('home.ctaTitle')}</h2>
          <div className="mt-6">
            <InstallButton lang={lang} />
          </div>
        </div>
      </section>
    </main>
  )
}
