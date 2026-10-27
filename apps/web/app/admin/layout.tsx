import type { ReactNode } from 'react'
import { cookies, headers } from 'next/headers'
import { adminLang } from '../../lib/admin/lang'
import AdminShell from './admin-shell'

// The root layout of the back office (the website has its own in app/(site)): picks the language, then hands over to the client shell.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const lang = adminLang({
    cookie: (await cookies()).get('admin-lang')?.value,
    acceptLanguage: (await headers()).get('accept-language'),
  })
  return (
    <html lang={lang} translate="no">
      <body>
        <AdminShell lang={lang}>{children}</AdminShell>
      </body>
    </html>
  )
}
