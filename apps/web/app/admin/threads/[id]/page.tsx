'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Alert, Button, List, Spin, Tag, Typography } from 'antd'
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
  reports: { flagId: string; reason: string | null; reporterName: string; resolved: boolean }[]
}

// A reported thread, read-only. The server logs every read; a thread with no report is 404.
export default function ThreadView() {
  const at = useAt()
  const lang = useAdminLang()
  const { id } = useParams<{ id: string }>()
  const [messages, setMessages] = useState<Msg[]>([])
  const [state, setState] = useState<'loading' | 'ok' | 'unavailable' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    setState('loading')
    fetch(`/api/admin/threads/${id}`, { credentials: 'same-origin' })
      .then(async (r) => {
        if (r.ok) {
          setMessages(((await r.json()) as { data: Msg[] }).data)
          setState('ok')
        } else setState(r.status === 404 || r.status === 403 ? 'unavailable' : 'error')
      })
      .catch(() => setState('error'))
  }, [id, attempt])
  return (
    <>
      <Typography.Title level={3}>{at('admin.thread.title')}</Typography.Title>
      {state === 'loading' && (
        <>
          <Spin /> <small>{at('admin.thread.loading')}</small>
        </>
      )}
      {state === 'unavailable' && <Alert type="warning" message={at('admin.thread.unavailable')} />}
      {state === 'error' && (
        <Alert type="error" message={at('admin.thread.error')} action={<Button size="small" onClick={() => setAttempt((n) => n + 1)}>{at('common.retry')}</Button>} />
      )}
      {state === 'ok' && (
        <>
          <p>
            <small>{at('admin.thread.logged')}</small>
          </p>
          {messages.length === 0 && <Alert type="info" message={at('admin.thread.empty')} />}
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
                {at('admin.thread.reportedBy', { name: r.reporterName, reason: r.reason ?? '' })}
              </Tag>
            ))}
          </List.Item>
        )}
      />
        </>
      )}
    </>
  )
}
