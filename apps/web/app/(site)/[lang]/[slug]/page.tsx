import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { asUser } from '@kando/db'
import { getPage } from '@kando/domain'
import type { Lang } from '@kando/i18n'
import { LangSwitch } from '@/components/lang-switch'
import { renderMarkdown } from '@/lib/markdown'
import { alternates, pageLang } from '@/lib/site'

type Args = { params: Promise<{ lang: string; slug: string }> }

// Cached; a staff edit refreshes it at once (public-cache.ts).
export const revalidate = 3600
export async function generateStaticParams() {
  return []
}

const load = cache((slug: string, lang: Lang) => asUser(null, (tx) => getPage(tx, slug, lang)))

export default async function Page({ params }: Args) {
  const { slug } = await params
  const lang = await pageLang(params)
  const page = await load(slug, lang)
  if (!page) notFound()
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 md:px-8">
      <LangSwitch lang={lang} path={`/${slug}`} />
      <h1 className="mt-4 mb-6 text-4xl font-extrabold">{page.title}</h1>
      {/* renderMarkdown escapes raw HTML and drops unsafe links */}
      <div
        className="space-y-4 leading-relaxed [&_a]:underline [&_h2]:text-2xl [&_h2]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_th]:border [&_th]:border-ink/30 [&_th]:bg-white [&_th]:p-3 [&_th]:text-left [&_th]:align-top [&_td]:border [&_td]:border-ink/30 [&_td]:p-3 [&_td]:text-left [&_td]:align-top"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(page.bodyMarkdown) }}
      />
    </main>
  )
}

export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const { slug } = await params
  const lang = await pageLang(params)
  const page = await load(slug, lang)
  return page ? { title: page.title, alternates: alternates(`/${slug}`, lang) } : {}
}
