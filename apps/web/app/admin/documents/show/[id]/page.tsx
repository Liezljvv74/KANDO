'use client'

import { useState } from 'react'
import { useCustomMutation, useShow } from '@refinedev/core'
import { Show } from '@refinedev/antd'
import { Button, Descriptions, Input, Space, Tag } from 'antd'
import { at } from '../../../../../lib/admin/t'

type Doc = { id: string; ownerEmail: string; requirement: string; status: string; note: string | null; reviewedAt: string | null; link: string }

export default function DocumentShow() {
  const { query, result } = useShow<Doc>()
  const [note, setNote] = useState('')
  const review = useCustomMutation()
  const decide = (decision: 'approved' | 'rejected') =>
    review.mutate({ url: `/api/admin/documents/${result?.id}/review`, method: 'post', values: { decision, note } }, { onSuccess: () => query.refetch() })
  return (
    <Show title={at('admin.resource.documents')} isLoading={query.isLoading} canEdit={false} canDelete={false}>
      {result && (
        <>
          <Descriptions column={1} bordered>
            <Descriptions.Item label={at('admin.field.email')}>{result.ownerEmail}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.requirement')}>{at(`admin.requirement.${result.requirement}` as 'admin.requirement.permit')}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.status')}>
              <Tag>{at(`admin.status.${result.status}` as 'admin.status.pending')}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label={at('admin.field.note')}>{result.note}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.reviewedAt')}>{result.reviewedAt && new Date(result.reviewedAt).toLocaleString('de-DE')}</Descriptions.Item>
          </Descriptions>
          <p>
            <a href={result.link} target="_blank" rel="noreferrer">
              {at('admin.action.openDocument')}
            </a>
          </p>
          {result.status === 'pending' && (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={at('admin.field.note')} />
              <Space>
                <Button type="primary" loading={review.mutation.isPending} onClick={() => decide('approved')}>
                  {at('admin.action.approve')}
                </Button>
                <Button danger loading={review.mutation.isPending} disabled={!note.trim()} onClick={() => decide('rejected')}>
                  {at('admin.action.reject')}
                </Button>
              </Space>
              <small>{at('admin.action.noteRequired')}</small>
            </Space>
          )}
        </>
      )}
    </Show>
  )
}
