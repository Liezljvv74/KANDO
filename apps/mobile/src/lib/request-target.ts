import type { ProviderDetail } from '@kando/contract'

type Service = ProviderDetail['services'][number]

/**
 * Where "Book" or "Request a quote" leads, or null when no request can be made (an older response without the provider id). One flow:
 * both open the request form (a fixed-price service is preselected); `book` only chooses the button's word.
 */
export function requestTarget(provider: ProviderDetail, service?: Service): { path: string; params: Record<string, string>; book: boolean } | null {
  if (!provider.providerId) return null
  if (service?.priceType === 'fixed' && service.price !== null)
    return { path: '/bookings/new-request', params: { providerId: provider.providerId, serviceId: service.id, ...(provider.worksRemotely && { remote: '1' }) }, book: true }
  return { path: '/bookings/new-request', params: { providerId: provider.providerId, ...(service && { serviceId: service.id }), ...(provider.worksRemotely && { remote: '1' }) }, book: false }
}

/** True only when the server says the provider cannot be booked yet; an older cached profile without `canBook` keeps today's buttons. */
export const notifyOnly = (provider: Pick<ProviderDetail, 'canBook'>): boolean => provider.canBook === false
