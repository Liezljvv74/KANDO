'use client'

import { useShow } from '@refinedev/core'
import { Show } from '@refinedev/antd'
import { Descriptions, Image, Space } from 'antd'
import { RemovePhotoButton } from '../../../../../lib/admin/RemovePhotoButton'
import { useAt } from '../../../../../lib/admin/t'

type Provider = {
  id: string
  publicName: string | null
  type: string | null
  status: string
  suspended: boolean
  ownerEmail: string
  photos: { id: string; kind: string; url: string; alt: string | null }[]
}

export default function ProviderShow() {
  const at = useAt()
  const { query, result } = useShow<Provider>()
  return (
    <Show title={at('admin.resource.providers')} isLoading={query.isLoading} canEdit={false} canDelete={false}>
      {result && (
        <>
          <Descriptions column={1} bordered>
            <Descriptions.Item label={at('admin.field.name')}>{result.publicName}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.owner')}>{result.ownerEmail}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.type')}>{result.type && at(`admin.type.${result.type}` as 'admin.type.private')}</Descriptions.Item>
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
                <RemovePhotoButton photoId={p.id} onDone={() => query.refetch()} />
              </Space>
            ))}
          </Space>
        </>
      )}
    </Show>
  )
}
