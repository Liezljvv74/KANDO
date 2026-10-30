import { revalidatePath } from 'next/cache'

// The page files with their route group: Next tags a cached page with its file path (app/(site)/...), groups included.
const ROUTES = {
  providers: '/(site)/[lang]/providers/[slug]',
  home: '/(site)/[lang]',
  pages: '/(site)/[lang]/[slug]',
} as const

/** Marks the cached public pages of a kind stale after a change, so the next visit renders them anew (both languages). With no Next request scope (vitest calls routes directly) it does nothing. */
export function refreshPublicPages(kind: keyof typeof ROUTES): void {
  try {
    revalidatePath(ROUTES[kind], 'page')
  } catch (e) {
    if (!(e instanceof Error && e.message.includes('static generation store missing'))) throw e
  }
}

const BY_RESOURCE: Record<string, keyof typeof ROUTES> = { providers: 'providers', photos: 'providers', categories: 'home', pages: 'pages' }

/** After a staff change through /api/admin/[resource]. */
export const refreshAfterAdminChange = (resource: string) => {
  if (Object.hasOwn(BY_RESOURCE, resource)) refreshPublicPages(BY_RESOURCE[resource]!)
}
