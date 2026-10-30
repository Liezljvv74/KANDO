'use client'

import { List, ShowButton, useTable } from '@refinedev/antd'
import { Button, Form, Input, Select, Space, Table, Tag } from 'antd'
import { BOOKING_STATUSES } from '@kando/contract'
import { money, statusLabel, when } from '../../../components/admin/booking-text'
import { useAdminLang, useAt } from '../../../lib/admin/t'

type Row = { id: string; status: string; startAt: string; amount: number; currency: string; customerEmail: string; providerName: string; parentBookingId: string | null; disputeDecideBy: string | null; disputeOverdue: boolean }

// Overdue disputes first (the server orders), then the nearest dispute deadline, then the newest booking.
export default function BookingsList() {
  const at = useAt()
  const lang = useAdminLang()
  const { tableProps, searchFormProps } = useTable({
    syncWithLocation: true,
    onSearch: (v) => {
      const { q, status } = v as { q?: string; status?: string }
      return [
        { field: 'q', operator: 'contains' as const, value: q },
        { field: 'status', operator: 'eq' as const, value: status },
      ]
    },
  })
  return (
    <List title={at('admin.resource.bookings')}>
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Form.Item name="q" noStyle>
            <Input allowClear placeholder={at('admin.action.search')} />
          </Form.Item>
          <Form.Item name="status" noStyle>
            <Select allowClear style={{ minWidth: 220 }} placeholder={at('admin.filter.allStatuses')} options={BOOKING_STATUSES.map((s) => ({ value: s, label: statusLabel(at, s) }))} />
          </Form.Item>
          <Button htmlType="submit" type="primary">
            {at('admin.action.filter')}
          </Button>
        </Space>
      </Form>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="status" title={at('admin.field.status')} render={(s: string, r: Row) => <Space>{statusLabel(at, s)}{r.parentBookingId && <Tag>{at('admin.field.children')}</Tag>}</Space>} />
        <Table.Column dataIndex="customerEmail" title={at('admin.field.customer')} />
        <Table.Column dataIndex="providerName" title={at('admin.field.provider')} />
        <Table.Column dataIndex="startAt" title={at('admin.field.startAt')} sorter render={(v: string) => when(lang, v)} />
        <Table.Column dataIndex="amount" title={at('admin.field.amount')} render={(v: number, r: Row) => money(lang, v, r.currency)} />
        <Table.Column
          dataIndex="disputeDecideBy"
          title={at('admin.field.decideBy')}
          render={(v: string | null, r: Row) => v && <Tag color={r.disputeOverdue ? 'red' : 'orange'}>{r.disputeOverdue ? `${at('admin.dispute.overdue')}: ${when(lang, v)}` : when(lang, v)}</Tag>}
        />
        <Table.Column title="" render={(_, r: Row) => <ShowButton hideText size="small" recordItemId={r.id} />} />
      </Table>
    </List>
  )
}
