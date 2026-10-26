import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { asUser } from '@kando/db'
import { getPage } from '@kando/domain'
import type { Lang } from '@kando/i18n'
import { LangSwitch } from '../../../components/lang-switch'
import { renderMarkdown } from '../../../lib/markdown'
import { alternates, siteLang } from '../../../lib/site'

type Args = { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> }

const load = cache((slug: string, lang: Lang) => asUser(null, (tx) => getPage(tx, slug, lang)))

export default async function Page({ params, searchParams }: Args) {
  const { slug } = await params
  const lang = siteLang((await searchParams).lang)
  const page = await load(slug, lang)
  if (!page) notFound()
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <LangSwitch lang={lang} path={`/${slug}`} />
      <h1 className="mt-4 mb-6 text-4xl font-extrabold">{page.title}</h1>
      {/* renderMarkdown escapes raw HTML and drops unsafe links */}
      <div
        className="space-y-4 leading-relaxed [&_a]:underline [&_h2]:text-2xl [&_h2]:font-bold [&_ul]:list-disc [&_ul]:pl-5"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(page.bodyMarkdown) }}
      />
    </main>
  )
}

export async function generateMetadata({ params, searchParams }: Args): Promise<Metadata> {
  const { slug } = await params
  const lang = siteLang((await searchParams).lang)
  const page = await load(slug, lang)
  return page ? { title: page.title, alternates: alternates(`/${slug}`, lang) } : {}
}
