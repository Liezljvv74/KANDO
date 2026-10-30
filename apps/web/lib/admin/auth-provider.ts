import type { AccessControlProvider, AuthProvider } from '@refinedev/core'
import { createAuthClient } from '@neondatabase/auth/next'
import { t } from '@kando/i18n'
import { browserAdminLang } from './lang'

export const authClient = createAuthClient()

export type Me = { id: string; email: string; staffRole: 'admin' | 'reviewer' }
const lang = () => browserAdminLang(document.cookie, navigator.languages)
const fetchMe = () => fetch('/api/admin/me', { credentials: 'same-origin' })

export const authProvider: AuthProvider = {
  // Signs in with the Neon Auth browser client, then asks the server whether the account has a staff role.
  async login({ email, password }: { email: string; password: string }) {
    const { error } = await authClient.signIn.email({ email, password })
    if (error) return { success: false, error: { name: 'LoginError', message: t(lang(), 'admin.signIn.failed') } }
    if (!(await fetchMe()).ok) {
      await authClient.signOut()
      return { success: false, error: { name: 'LoginError', message: t(lang(), 'admin.signIn.denied') } }
    }
    return { success: true, redirectTo: '/admin' }
  },
  async logout() {
    await authClient.signOut()
    return { success: true, redirectTo: '/admin/sign-in' }
  },
  // 401: not signed in. 403: signed in without a staff role: the sign-in page shows "No access" and a sign-out link.
  async check() {
    const res = await fetchMe()
    if (res.ok) return { authenticated: true }
    return { authenticated: false, redirectTo: res.status === 403 ? '/admin/sign-in?denied=1' : '/admin/sign-in' }
  },
  async onError(error) {
    return error?.statusCode === 401 ? { logout: true, redirectTo: '/admin/sign-in' } : { error }
  },
  async getIdentity() {
    const res = await fetchMe()
    return res.ok ? ((await res.json()) as Me) : undefined
  },
}

// A Reviewer sees documents, users, providers, flags, bookings, disputes, refunds and reviews (read only); an Administrator
// everything (deciding, settling and hiding too). The server enforces it anyway.
export const accessControlProvider: AccessControlProvider = {
  async can({ resource, action }) {
    const me = (await authProvider.getIdentity!()) as Me | undefined
    if (!me) return { can: false }
    if (me.staffRole === 'admin') return { can: true }
    return { can: ['documents', 'users', 'providers', 'flags', 'bookings', 'disputes', 'refunds', 'reviews'].includes(resource ?? '') && ['list', 'show'].includes(action) }
  },
}
