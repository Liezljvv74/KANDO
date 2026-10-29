'use client'

import Link from 'next/link'
import { useCustomMutation, useGetIdentity, useShow } from '@refinedev/core'
import { Show } from '@refinedev/antd'
import { Button, Descriptions, List, Tag } from 'antd'
import { LOCALE } from '@kando/i18n'
import { useAdminLang, useAt } from '../../../../../lib/admin/t'

type Flag = {
  id: string
  kind: string
  userEmail: string | null
  note: string | null
  createdAt: string
  resolvedAt: string | null
  threadId: string | null
  attempts: { hit: string; text: string; createdAt: string }[]
}

export default function FlagShow() {
  const at = useAt()
  const lang = useAdminLang()
  const { query, result } = useShow<Flag>()
  const { data: me } = useGetIdentity<{ staffRole: string }>()
  const resolve = useCustomMutation()
  const when = (v: string) => new Date(v).toLocaleString(LOCALE[lang])
  return (
    <Show title={at('admin.resource.flags')} isLoading={query.isLoading} canEdit={false} canDelete={false}>
      {result && (
        <>
          <Descriptions column={1} bordered>
            <Descriptions.Item label={at('admin.field.kind')}>{at(`admin.flag.kind.${result.kind}` as 'admin.flag.kind.message-reported')}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.user')}>{result.userEmail}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.reason')}>{result.note}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.createdAt')}>{when(result.createdAt)}</Descriptions.Item>
            <Descriptions.Item label={at('admin.field.status')}>
              {result.resolvedAt ? <Tag color="green">{at('admin.flag.resolved')}</Tag> : <Tag color="orange">{at('admin.flag.open')}</Tag>}
            </Descriptions.Item>
          </Descriptions>
          {result.threadId && (
            <p>
              <Link href={`/admin/threads/${result.threadId}`}>{at('admin.action.openThread')}</Link> <small>{at('admin.thread.logged')}</small>
            </p>
          )}
          {result.attempts.length > 0 && (
            <List
              header={at('admin.field.blockedText')}
              bordered
              dataSource={result.attempts}
              renderItem={(a) => (
                <List.Item>
                  {when(a.createdAt)}: {a.text}
                </List.Item>
              )}
            />
          )}
          {!result.resolvedAt && me?.staffRole === 'admin' && (
            <p>
              <Button type="primary" loading={resolve.mutation.isPending} onClick={() => resolve.mutate({ url: `/api/admin/flags/${result.id}/resolve`, method: 'post', values: {} }, { onSuccess: () => query.refetch() })}>
                {at('admin.action.resolve')}
              </Button>
            </p>
          )}
        </>
      )}
    </Show>
  )
}
