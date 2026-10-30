import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { t } from '@kando/i18n'
import { siteLang } from '../../../lib/site'

export const metadata: Metadata = { robots: { index: false, follow: false } }

// Stripe's success and cancel address: the webhook confirms the payment, this page only says so and leads back to the app.
// The address carries nothing of the booking (only ?lang=).
export default async function PaymentDone() {
  const lang = siteLang((await headers()).get('x-lang'))
  return (
    <main className="mx-auto max-w-3xl px-4 py-20">
      <h1 className="text-3xl font-extrabold">{t(lang, 'web.paymentDone.title')}</h1>
      <p className="mt-2">{t(lang, 'web.paymentDone.body')}</p>
      <a href="skilled://bookings" className="mt-4 inline-block underline">
        {t(lang, 'web.paymentDone.back')}
      </a>
    </main>
  )
}
