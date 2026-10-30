'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useCustomMutation, useGetIdentity, useShow } from '@refinedev/core'
import { Show } from '@refinedev/antd'
import { Alert, Button, Descriptions, Input, InputNumber, Radio, Space, Tag } from 'antd'
import { money, statusLabel, when } from '../../../../../components/admin/booking-text'
import { useAdminLang, useAt } from '../../../../../lib/admin/t'

type Decision = 'full-payout' | 'partial' | 'full-refund'
type Dispute = {
  id: string
  bookingId: string
  openedBy: 'customer' | 'provider' | null
  reason: string
  description: string
  createdAt: string
  decideBy: string
  decision: Decision | null
  providerShare: number | null
  decisionReason: string | null
  decidedAt: string | null
  paid: number
  threadId: string | null
  booking: { status: string; currency: string; amount: number; customerEmail: string | null; providerName: string | null; stopAmount: number | null; stopNote: string | null; noShow: string | null }
}

// Reading this page is logged (staff_access_log, the dispute as the reason). Only an Administrator decides.
export default function DisputeShow() {
  const at = useAt()
  const lang = useAdminLang()
  const { query, result: d } = useShow<Dispute>()
  const { data: me } = useGetIdentity<{ staffRole: string }>()
  const decide = useCustomMutation()
  const [decision, setDecision] = useState<Decision>('partial')
  const [share, setShare] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const ready = reason.trim().length >= 10 && (decision !== 'partial' || (share !== null && share > 0 && d !== undefined && share < d.paid))
  return (
    <Show title={at('admin.one.disputes')} isLoading={query.isLoading} canEdit={false} canDelete={false}>
      {d && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Descriptions column={1} bordered>
            <Descriptions.Item label={at('admin.field.reason')}>{at(`admin.disputeReason.${d.reason}` as 'admin.disputeReason.problem')}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.openedBy')}>{d.openedBy ? at(d.openedBy === 'customer' ? 'admin.field.customer' : 'admin.field.provider') : at('admin.field.system')}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.description')}>{d.description}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.customer')}>{d.booking.customerEmail}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.provider')}>{d.booking.providerName}</Descriptions.Item>
            <Descriptions.Item label={at('admin.one.bookings')}>
              <Link href={`/admin/bookings/show/${d.bookingId}`}>{statusLabel(at, d.booking.status)}</Link>
            </Descriptions.Item>
            <Descriptions.Item label={at('admin.field.amount')}>{money(lang, d.booking.amount, d.booking.currency)}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.paid')}>{money(lang, d.paid, d.booking.currency)}</Descriptions.Item>
            {d.booking.stopAmount !== null && <Descriptions.Item label={at('admin.field.stopAmount')}>{money(lang, d.booking.stopAmount, d.booking.currency)} {d.booking.stopNote}</Descriptions.Item>}
            {d.booking.noShow && <Descriptions.Item label={at('admin.field.noShow')}>{at(d.booking.noShow === 'customer' ? 'admin.field.customer' : 'admin.field.provider')}</Descriptions.Item>}
            <Descriptions.Item label={at('admin.field.decideBy')}>{when(lang, d.decideBy)}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.decision')}>
              {d.decision ? (
                <>
                  <Tag color="green">{at(`admin.decision.${d.decision}` as 'admin.decision.partial')}</Tag> {money(lang, d.providerShare, d.booking.currency)} ({when(lang, d.decidedAt)})
                  <p>{d.decisionReason}</p>
                </>
              ) : (
                <Tag color="orange">{at('admin.dispute.undecided')}</Tag>
              )}
            </Descriptions.Item>
          </Descriptions>
          {d.decision && d.booking.status === 'disputed' && <Alert type="warning" message={at('admin.dispute.pending')} />}
          {d.threadId && (
            <p>
              <Link href={`/admin/threads/${d.threadId}`}>{at('admin.action.openThread')}</Link> <small>{at('admin.thread.logged')}</small>
            </p>
          )}
          {!d.decision && me?.staffRole === 'admin' && (
            <Space direction="vertical" style={{ width: '100%' }}>
              <small>{at('admin.decide.hint')}</small>
              <Radio.Group value={decision} onChange={(e) => setDecision(e.target.value)}>
                <Space direction="vertical">
                  {(['full-payout', 'partial', 'full-refund'] as const).map((x) => (
                    <Radio key={x} value={x}>
                      {at(`admin.decision.${x}`)}
                    </Radio>
                  ))}
                </Space>
              </Radio.Group>
              {decision === 'partial' && (
                <InputNumber min={0.01} max={d.paid} step={0.01} precision={2} value={share} onChange={setShare} addonBefore={at('admin.field.providerShare')} placeholder={d.booking.stopAmount !== null ? String(d.booking.stopAmount) : undefined} />
              )}
              <Input.TextArea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={at('admin.field.decisionReason')} />
              <small>{at('admin.reasonRequired')}</small>
              <Button
                type="primary"
                danger
                loading={decide.mutation.isPending}
                disabled={!ready}
                onClick={() =>
                  decide.mutate({ url: `/api/admin/disputes/${d.id}/decide`, method: 'post', values: { decision, reason, ...(decision === 'partial' && { providerShare: share }) } }, { onSuccess: () => query.refetch() })
                }
              >
                {at('admin.action.decide')}
              </Button>
            </Space>
          )}
        </Space>
      )}
    </Show>
  )
}
