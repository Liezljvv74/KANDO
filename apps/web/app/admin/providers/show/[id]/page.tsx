'use client'

import { useCustomMutation, useShow } from '@refinedev/core'
import { Show } from '@refinedev/antd'
import { Button, Descriptions, Image, Popconfirm, Space } from 'antd'
import { at } from '../../../../../lib/admin/t'

type Provider = {
  id: string
  displayName: string
  type: string
  status: string
  suspended: boolean
  ownerEmail: string
  photos: { id: string; kind: string; url: string; alt: string | null }[]
}

export default function ProviderShow() {
  const { query, result } = useShow<Provider>()
  const remove = useCustomMutation()
  return (
    <Show title={at('admin.resource.providers')} isLoading={query.isLoading} canEdit={false} canDelete={false}>
      {result && (
        <>
          <Descriptions column={1} bordered>
            <Descriptions.Item label={at('admin.field.name')}>{result.displayName}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.owner')}>{result.ownerEmail}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.type')}>{at(`admin.type.${result.type}` as 'admin.type.private')}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.status')}>
              {at(`admin.status.${result.status}` as 'admin.status.draft')}
              {result.suspended && ` (${at('admin.status.suspended')})`}
            </Descriptions.Item>
          </Descriptions>
          <h4 style={{ marginTop: 16 }}>{at('admin.field.photos')}</h4>
          <Space wrap>
            {result.photos.map((p) => (
              <Space key={p.id} direction="vertical">
                <Image src={p.url} alt={p.alt ?? ''} width={160} />
                <Popconfirm title={at('admin.action.deletePhoto')} onConfirm={() => remove.mutate({ url: `/api/admin/photos/${p.id}`, method: 'delete', values: {} }, { onSuccess: () => query.refetch() })}>
                  <Button danger size="small">
                    {at('admin.action.deletePhoto')}
                  </Button>
                </Popconfirm>
              </Space>
            ))}
          </Space>
        </>
      )}
    </Show>
  )
}
