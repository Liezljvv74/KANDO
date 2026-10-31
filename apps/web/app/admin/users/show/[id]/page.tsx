'use client'

import { useState } from 'react'
import { useCustomMutation, useGetIdentity, useShow } from '@refinedev/core'
import { Show } from '@refinedev/antd'
import { Button, DatePicker, Descriptions, Image, Input, Space } from 'antd'
import type { Dayjs } from 'dayjs'
import { LOCALE } from '@kando/i18n'
import { RemovePhotoButton } from '../../../../../lib/admin/RemovePhotoButton'
import { useAdminLang, useAt } from '../../../../../lib/admin/t'

type User = { id: string; email: string; firstName: string | null; lastName: string | null; address: { street: string | null; postcode: string; city: string | null; country: string } | null; photoUrl: string | null; photoId: string | null; staffRole: string | null; suspendedUntil: string | null; suspendedReason: string | null; createdAt: string }

export default function UserShow() {
  const at = useAt()
  const lang = useAdminLang()
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
            <Descriptions.Item label={at('admin.field.firstName')}>{result.firstName}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.lastName')}>{result.lastName}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.address')}>
              {result.address && [result.address.street, [result.address.postcode, result.address.city].filter(Boolean).join(' '), result.address.country].filter(Boolean).join(', ')}
            </Descriptions.Item>
            <Descriptions.Item label={at('admin.field.picture')}>
              {result.photoUrl && <Image src={result.photoUrl} alt="" width={96} />}
              {result.photoId && <RemovePhotoButton photoId={result.photoId} onDone={() => query.refetch()} style={{ marginLeft: 8 }} />}
            </Descriptions.Item>
            <Descriptions.Item label={at('admin.field.role')}>{result.staffRole && at(result.staffRole === 'admin' ? 'admin.role.administrator' : 'admin.role.reviewer')}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.suspendedUntil')}>{result.suspendedUntil && new Date(result.suspendedUntil).toLocaleString(LOCALE[lang])}</Descriptions.Item>
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
                <Button disabled={!result.suspendedUntil} onClick={() => send(null)}>
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
