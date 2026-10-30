'use client'

import { useState } from 'react'
import { List, useTable } from '@refinedev/antd'
import { useCustomMutation, useGetIdentity } from '@refinedev/core'
import { Button, Input, Modal, Table, Tag } from 'antd'
import { SearchForm, searchByText } from '../../../components/admin/search-form'
import { when } from '../../../components/admin/booking-text'
import { useAdminLang, useAt } from '../../../lib/admin/t'

type Row = { id: string; authorEmail: string; subjectEmail: string; authorRole: string; stars: number; text: string | null; hidden: boolean; hiddenReason: string | null; visibleAt: string | null; createdAt: string }

// Staff see every review, also before it is shown. Hiding or showing again needs a reason; only an Administrator may.
export default function ReviewsList() {
  const at = useAt()
  const lang = useAdminLang()
  const { tableProps, searchFormProps, tableQuery } = useTable({ syncWithLocation: true, onSearch: searchByText })
  const { data: me } = useGetIdentity<{ staffRole: string }>()
  const moderate = useCustomMutation()
  const [target, setTarget] = useState<Row | null>(null)
  const [reason, setReason] = useState('')
  const close = () => {
    setTarget(null)
    setReason('')
  }
  return (
    <List title={at('admin.resource.reviews')}>
      <SearchForm formProps={searchFormProps} />
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="authorEmail" title={at('admin.field.author')} />
        <Table.Column dataIndex="subjectEmail" title={at('admin.field.subject')} />
        <Table.Column dataIndex="stars" title={at('admin.field.stars')} />
        <Table.Column dataIndex="text" title={at('admin.field.reviewText')} />
        <Table.Column dataIndex="visibleAt" title={at('admin.field.visibleAt')} render={(v: string | null) => (v ? when(lang, v) : at('admin.review.notYet'))} />
        <Table.Column
          dataIndex="hidden"
          title={at('admin.field.status')}
          render={(h: boolean, r: Row) => (h ? <Tag color="red" title={r.hiddenReason ?? ''}>{at('admin.review.hidden')}</Tag> : <Tag color="green">{at('admin.review.shown')}</Tag>)}
        />
        {me?.staffRole === 'admin' && <Table.Column title="" render={(_, r: Row) => <Button size="small" danger={!r.hidden} onClick={() => setTarget(r)}>{at(r.hidden ? 'admin.action.unhide' : 'admin.action.hide')}</Button>} />}
      </Table>
      <Modal
        open={target !== null}
        title={target && at(target.hidden ? 'admin.action.unhide' : 'admin.action.hide')}
        okButtonProps={{ disabled: reason.trim().length < 10, loading: moderate.mutation.isPending }}
        onCancel={close}
        onOk={() =>
          target &&
          moderate.mutate({ url: `/api/admin/reviews/${target.id}/hide`, method: 'post', values: { hidden: !target.hidden, reason } }, { onSuccess: () => { close(); void tableQuery.refetch() } })
        }
      >
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={at('admin.field.reason')} />
        <small>{at('admin.reasonRequired')}</small>
      </Modal>
    </List>
  )
}
