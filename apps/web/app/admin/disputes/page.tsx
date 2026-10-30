'use client'

import { List, ShowButton, useTable } from '@refinedev/antd'
import { Table, Tag } from 'antd'
import { when } from '../../../components/admin/booking-text'
import { useAdminLang, useAt } from '../../../lib/admin/t'

type Row = { id: string; reason: string; decision: string | null; decideBy: string; decidedAt: string | null; overdue: boolean; customerEmail: string; providerName: string }

// Undecided disputes first, nearest deadline first (the server orders); then the decided ones.
export default function DisputesList() {
  const at = useAt()
  const lang = useAdminLang()
  const { tableProps } = useTable({ syncWithLocation: true })
  return (
    <List title={at('admin.resource.disputes')}>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="reason" title={at('admin.field.reason')} render={(r: string) => at(`admin.disputeReason.${r}` as 'admin.disputeReason.problem')} />
        <Table.Column dataIndex="customerEmail" title={at('admin.field.customer')} />
        <Table.Column dataIndex="providerName" title={at('admin.field.provider')} />
        <Table.Column dataIndex="decideBy" title={at('admin.field.decideBy')} sorter render={(v: string, r: Row) => (r.decidedAt ? when(lang, v) : <Tag color={r.overdue ? 'red' : 'orange'}>{when(lang, v)}</Tag>)} />
        <Table.Column
          dataIndex="decision"
          title={at('admin.field.decision')}
          render={(d: string | null, r: Row) => (d ? at(`admin.decision.${d}` as 'admin.decision.partial') : <Tag color={r.overdue ? 'red' : 'orange'}>{at(r.overdue ? 'admin.dispute.overdue' : 'admin.dispute.undecided')}</Tag>)}
        />
        <Table.Column title="" render={(_, r: Row) => <ShowButton hideText size="small" recordItemId={r.id} />} />
      </Table>
    </List>
  )
}
