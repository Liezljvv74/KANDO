import { router } from 'expo-router'

import { setAfterLogin } from '@/lib/after-login'

/** A signed-out person tapped Request, Book or "notify me": log in or sign up first, then come back to this provider's page. */
export function logInThenBack(slug: string) {
  void setAfterLogin(`/provider/${slug}`)
  router.push('/login')
}
