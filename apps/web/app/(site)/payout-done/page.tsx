import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { t } from '@kando/i18n'
import { siteLang } from '../../../lib/site'

export const metadata: Metadata = { robots: { index: false, follow: false } }

// Stripe's return and refresh address after the payout set-up: the app asks Stripe for the state, this page only leads
// back to it. The address carries nothing but ?lang=.
export default async function PayoutDone() {
  const lang = siteLang((await headers()).get('x-lang'))
  return (
    <main className="mx-auto max-w-3xl px-4 py-20">
      <h1 className="text-3xl font-extrabold">{t(lang, 'payouts.doneTitle')}</h1>
      <p className="mt-2">{t(lang, 'payouts.doneBody')}</p>
      <a href="skilled://my-profile" className="mt-4 inline-block underline">
        {t(lang, 'payouts.back')}
      </a>
    </main>
  )
}
