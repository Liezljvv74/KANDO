import type { ProviderMoney } from '@kando/contract'

import { api } from '@/api/client'

/** The provider's net amounts for the Jobs strip (provider only). */
export const getProviderMoney = () => api<ProviderMoney>('/app-api/v1/provider-money')
