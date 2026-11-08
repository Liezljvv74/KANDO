import type { QuoteListItem } from '@kando/contract'

import { formatPrice } from '@/lib/format'

export const price = (q: Pick<QuoteListItem, 'amount' | 'currency'>) => formatPrice({ priceType: 'fixed', price: q.amount, currency: q.currency })
