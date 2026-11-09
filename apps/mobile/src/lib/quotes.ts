import type { QuoteListItem } from '@kando/contract'

import { formatAmount } from '@/lib/format'

export const price = (q: Pick<QuoteListItem, 'amount' | 'currency'>) => formatAmount(q.amount, q.currency)
