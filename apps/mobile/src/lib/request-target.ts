import type { ProviderDetail } from '@kando/contract'

type Service = ProviderDetail['services'][number]

/** Where "Book" or "Request a quote" leads, or null when no request can be made (an older response without the provider id). */
export function requestTarget(provider: ProviderDetail, service?: Service): { path: string; params: Record<string, string>; book: boolean } | null {
  if (!provider.providerId) return null
  if (service?.priceType === 'fixed' && service.price !== null)
    return { path: '/bookings/book', params: { slug: provider.slug, serviceId: service.id, ...(provider.worksRemotely && { remote: '1' }) }, book: true }
  return { path: '/bookings/new-request', params: { providerId: provider.providerId, ...(service && { serviceId: service.id }) }, book: false }
}
