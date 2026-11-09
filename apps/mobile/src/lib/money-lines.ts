import type { Booking } from '@kando/contract'

import { t } from '@/i18n'

const pct = (rate: number) => Math.round(rate * 100)
const cents = (n: number) => Math.round(n * 100) / 100

/**
 * The rows of the provider's money box: the service, each additional task, the total paid, the commission and what the provider
 * receives. Each booking carries its own amounts (stored rate, or the current one before payment); the commission line names the
 * job's own rate. ponytail: tasks at a different rate are summed, the label shows the job's rate.
 */
export function moneyLines(b: Booking, tasks: Booking[]): Array<{ label: string; amount: number }> {
  if (!b.money) return []
  const parts = [b, ...tasks.filter((x) => x.money)]
  const sum = (k: 'total' | 'commission' | 'net') => cents(parts.reduce((s, x) => s + x.money![k], 0))
  const expected = b.status === 'awaiting-time' || b.status === 'awaiting-payment'
  return [
    { label: t('money.line.service'), amount: b.money.total },
    ...tasks.filter((x) => x.money).map((x, i) => ({ label: t('money.line.task', { n: i + 1 }), amount: x.money!.total })),
    { label: t('money.line.total'), amount: sum('total') },
    { label: t('money.line.commission', { rate: pct(b.money.rate) }), amount: -sum('commission') },
    { label: t(expected ? 'money.line.receiveExpected' : 'money.line.receive'), amount: sum('net') },
  ]
}
