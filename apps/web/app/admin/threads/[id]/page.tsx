'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { List, Tag, Typography } from 'antd'
import { LOCALE } from '@kando/i18n'
import { useAdminLang, useAt } from '../../../../lib/admin/t'

type Msg = {
  id: string
  senderName: string
  senderRole: 'customer' | 'provider'
  kind: string
  body: string | null
  photoUrl: string | null
  createdAt: string
  reports: { flagId: string; reason: string | null; reporterId: string | null; resolved: boolean }[]
}

// A reported thread, read-only. The server logs every read; a thread with no report is 404.
export default function ThreadView() {
  const at = useAt()
  const lang = useAdminLang()
  const { id } = useParams<{ id: string }>()
  const [messages, setMessages] = useState<Msg[]>([])
  useEffect(() => {
    void fetch(`/api/admin/threads/${id}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b: { data: Msg[] }) => setMessages(b.data))
  }, [id])
  return (
    <>
      <Typography.Title level={3}>{at('admin.thread.title')}</Typography.Title>
      <p>
        <small>{at('admin.thread.logged')}</small>
      </p>
      <List
        bordered
        dataSource={messages}
        renderItem={(m) => (
          <List.Item style={{ display: 'block' }}>
            <strong>{m.senderName}</strong> <Tag>{at(m.senderRole === 'customer' ? 'admin.thread.customer' : 'admin.thread.provider')}</Tag> <small>{new Date(m.createdAt).toLocaleString(LOCALE[lang])}</small>
            <div>
              {m.body}
              {m.photoUrl && (
                <a href={m.photoUrl} target="_blank" rel="noreferrer">
                  {at('admin.thread.photo')}
                </a>
              )}
            </div>
            {m.reports.map((r) => (
              <Tag key={r.flagId} color={r.resolved ? 'green' : 'red'}>
                {at('admin.thread.reportedBy', { name: r.reporterId ?? '', reason: r.reason ?? '' })}
              </Tag>
            ))}
          </List.Item>
        )}
      />
    </>
  )
}
