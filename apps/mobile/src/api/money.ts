import type { ProviderMoney } from '@kando/contract'

import { api } from '@/api/client'

/** The provider's net amounts for the Jobs strip (provider only). */
export const getProviderMoney = () => {
  // the month is the one of this device (its time zone), not the server's
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()
  return api<ProviderMoney>(`/app-api/v1/provider-money?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
}
