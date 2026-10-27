'use client'

import { useState } from 'react'
import { useCustomMutation, useGetIdentity, useShow } from '@refinedev/core'
import { Show } from '@refinedev/antd'
import { Button, DatePicker, Descriptions, Input, Space } from 'antd'
import type { Dayjs } from 'dayjs'
import { at } from '../../../../../lib/admin/t'

type User = { id: string; email: string; name: string | null; staffRole: string | null; suspendedUntil: string | null; suspendedReason: string | null; liftPending: boolean; createdAt: string }

export default function UserShow() {
  const { query, result } = useShow<User>()
  const { data: me } = useGetIdentity<{ staffRole: string }>()
  const [until, setUntil] = useState<Dayjs | null>(null)
  const [reason, setReason] = useState('')
  const suspend = useCustomMutation()
  const send = (u: string | null) =>
    suspend.mutate({ url: `/api/admin/users/${result?.id}/suspend`, method: 'post', values: { until: u, reason } }, { onSuccess: () => query.refetch() })
  return (
    <Show title={at('admin.resource.users')} isLoading={query.isLoading} canEdit={false} canDelete={false}>
      {result && (
        <>
          <Descriptions column={1} bordered>
            <Descriptions.Item label={at('admin.field.email')}>{result.email}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.name')}>{result.name}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.role')}>{result.staffRole && at(result.staffRole === 'admin' ? 'admin.role.administrator' : 'admin.role.reviewer')}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.suspendedUntil')}>{result.suspendedUntil && new Date(result.suspendedUntil).toLocaleString('de-DE')}{result.liftPending && ` (${at('admin.suspension.expired')})`}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.reason')}>{result.suspendedReason}</Descriptions.Item>
          </Descriptions>
          {me?.staffRole === 'admin' && (
            <Space direction="vertical" style={{ marginTop: 16, width: '100%' }}>
              <DatePicker showTime value={until} onChange={setUntil} />
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={at('admin.field.reason')} />
              <Space>
                <Button danger disabled={!until || !reason.trim()} loading={suspend.mutation.isPending} onClick={() => send(until!.toISOString())}>
                  {at('admin.action.suspend')}
                </Button>
                <Button disabled={!result.suspendedUntil && !result.liftPending} onClick={() => send(null)}>
                  {at('admin.action.unsuspend')}
                </Button>
              </Space>
            </Space>
          )}
        </>
      )}
    </Show>
  )
}
