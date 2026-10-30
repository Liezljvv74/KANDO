'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useCustomMutation, useGetIdentity, useShow } from '@refinedev/core'
import { Show } from '@refinedev/antd'
import { Button, Descriptions, Input, InputNumber, Space, Table, Tag } from 'antd'
import { money, statusLabel, when } from '../../../../../components/admin/booking-text'
import { useAdminLang, useAt } from '../../../../../lib/admin/t'

type Booking = {
  id: string
  status: string
  startAt: string
  durationMin: number
  amount: number
  currency: string
  paid: number
  customerEmail: string | null
  customerName: string | null
  providerName: string | null
  providerEmail: string | null
  parentBookingId: string | null
  paidAt: string | null
  releasedAt: string | null
  finishedAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  noShow: string | null
  stopAmount: number | null
  stopNote: string | null
  threadId: string | null
  ledger: { kind: string; amount: number; createdAt: string }[]
  children: { id: string; status: string; amount: number; releasedAt: string | null }[]
  dispute: { id: string; decision: string | null } | null
}

/** Settling by hand: for a paid booking that is not settled yet and not disputed (a dispute is decided on its own page). */
const SETTLEABLE = ['confirmed', 'finished', 'stopped', 'cancelled']

export default function BookingShow() {
  const at = useAt()
  const lang = useAdminLang()
  const { query, result: b } = useShow<Booking>()
  const { data: me } = useGetIdentity<{ staffRole: string }>()
  const settle = useCustomMutation()
  const [share, setShare] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const canSettle = b && me?.staffRole === 'admin' && b.paidAt && !b.releasedAt && SETTLEABLE.includes(b.status)
  return (
    <Show title={at('admin.one.bookings')} isLoading={query.isLoading} canEdit={false} canDelete={false}>
      {b && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Descriptions column={1} bordered>
            <Descriptions.Item label={at('admin.field.status')}>{statusLabel(at, b.status)}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.customer')}>{[b.customerName, b.customerEmail].filter(Boolean).join(', ')}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.provider')}>{[b.providerName, b.providerEmail].filter(Boolean).join(', ')}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.startAt')}>{when(lang, b.startAt)} ({b.durationMin} min)</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.amount')}>{money(lang, b.amount, b.currency)}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.paid')}>{money(lang, b.paid, b.currency)}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.paidAt')}>{when(lang, b.paidAt)}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.releasedAt')}>{when(lang, b.releasedAt)}</Descriptions.Item>
            {b.noShow && <Descriptions.Item label={at('admin.field.noShow')}>{at(b.noShow === 'customer' ? 'admin.field.customer' : 'admin.field.provider')}</Descriptions.Item>}
            {b.stopAmount !== null && <Descriptions.Item label={at('admin.field.stopAmount')}>{money(lang, b.stopAmount, b.currency)} {b.stopNote}</Descriptions.Item>}
            {b.parentBookingId && (
              <Descriptions.Item label={at('admin.one.bookings')}>
                <Link href={`/admin/bookings/show/${b.parentBookingId}`}>{b.parentBookingId}</Link>
              </Descriptions.Item>
            )}
            {b.dispute && (
              <Descriptions.Item label={at('admin.field.dispute')}>
                <Link href={`/admin/disputes/show/${b.dispute.id}`}>{b.dispute.decision ? at(`admin.decision.${b.dispute.decision}` as 'admin.decision.partial') : at('admin.dispute.undecided')}</Link>
              </Descriptions.Item>
            )}
          </Descriptions>
          {b.threadId && (
            <p>
              <Link href={`/admin/threads/${b.threadId}`}>{at('admin.action.openThread')}</Link> <small>{at('admin.thread.logged')}</small>
            </p>
          )}
          <Table
            title={() => at('admin.field.ledger')}
            dataSource={b.ledger}
            rowKey={(r) => `${r.kind}-${r.createdAt}`}
            pagination={false}
            columns={[
              { dataIndex: 'kind', render: (k: string) => at(`admin.ledger.${k}` as 'admin.ledger.charge') },
              { dataIndex: 'amount', render: (v: number) => money(lang, v, b.currency) },
              { dataIndex: 'createdAt', render: (v: string) => when(lang, v) },
            ]}
          />
          {b.children.length > 0 && (
            <Table
              title={() => at('admin.field.children')}
              dataSource={b.children}
              rowKey="id"
              pagination={false}
              columns={[
                { dataIndex: 'id', render: (id: string) => <Link href={`/admin/bookings/show/${id}`}>{id.slice(0, 8)}</Link> },
                { dataIndex: 'status', render: (s: string) => statusLabel(at, s) },
                { dataIndex: 'amount', render: (v: number) => money(lang, v, b.currency) },
                { dataIndex: 'releasedAt', render: (v: string | null) => v && <Tag color="green">{when(lang, v)}</Tag> },
              ]}
            />
          )}
          {canSettle && (
            <Space direction="vertical" style={{ width: '100%' }}>
              <small>{at('admin.settle.hint')}</small>
              <InputNumber min={0} max={b.paid} step={0.01} precision={2} value={share} onChange={setShare} addonBefore={at('admin.field.providerShare')} />
              <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={at('admin.field.reason')} />
              <small>{at('admin.reasonRequired')}</small>
              <Button
                danger
                loading={settle.mutation.isPending}
                disabled={share === null || reason.trim().length < 10}
                onClick={() => settle.mutate({ url: `/api/admin/bookings/${b.id}/refund`, method: 'post', values: { providerShare: share, reason } }, { onSuccess: () => query.refetch() })}
              >
                {at('admin.action.settle')}
              </Button>
            </Space>
          )}
        </Space>
      )}
    </Show>
  )
}
