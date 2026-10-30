'use client'

import Link from 'next/link'
import { List, useTable } from '@refinedev/antd'
import { Table } from 'antd'
import { SearchForm, searchByText } from '../../../components/admin/search-form'
import { money, statusLabel, when } from '../../../components/admin/booking-text'
import { useAdminLang, useAt } from '../../../lib/admin/t'

type Row = { id: string; bookingId: string; amount: number; currency: string; createdAt: string; bookingStatus: string; customerEmail: string; providerName: string }

// The refund rows of the money ledger, newest first. A refund after the payout is done in the Stripe dashboard.
export default function RefundsList() {
  const at = useAt()
  const lang = useAdminLang()
  const { tableProps, searchFormProps } = useTable({ syncWithLocation: true, onSearch: searchByText })
  return (
    <List title={at('admin.resource.refunds')}>
      <SearchForm formProps={searchFormProps} />
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="createdAt" title={at('admin.field.createdAt')} render={(v: string) => when(lang, v)} />
        <Table.Column dataIndex="amount" title={at('admin.field.amount')} render={(v: number, r: Row) => money(lang, v, r.currency)} />
        <Table.Column dataIndex="customerEmail" title={at('admin.field.customer')} />
        <Table.Column dataIndex="providerName" title={at('admin.field.provider')} />
        <Table.Column dataIndex="bookingStatus" title={at('admin.one.bookings')} render={(s: string, r: Row) => <Link href={`/admin/bookings/show/${r.bookingId}`}>{statusLabel(at, s)}</Link>} />
      </Table>
    </List>
  )
}
