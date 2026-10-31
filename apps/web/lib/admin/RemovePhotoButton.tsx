'use client'

import { useState, type CSSProperties } from 'react'
import { useCustomMutation, useNotification, type HttpError } from '@refinedev/core'
import { Button, Input, Popconfirm, Space } from 'antd'
import { useAt } from './t'

/** Staff remove a photo: a reason is required, and the person is emailed it (user and provider pages share this). */
export function RemovePhotoButton({ photoId, onDone, style }: { photoId: string; onDone: () => void; style?: CSSProperties }) {
  const at = useAt()
  const [reason, setReason] = useState('')
  const remove = useCustomMutation()
  const { open } = useNotification()
  // what went wrong, the likely cause and what to do next (the raw server text is English and has no next step)
  const fail = (e: HttpError) => {
    const gone = e.statusCode === 404
    open?.({ type: 'error', message: at('admin.notify.error'), description: at(gone ? 'admin.photoRemoval.gone' : 'admin.photoRemoval.failed') })
    if (gone) onDone() // someone removed it already: the refreshed page no longer lists it
  }
  return (
    <Popconfirm
      title={at('admin.action.deletePhoto')}
      description={
        <Space direction="vertical" style={{ width: 280 }}>
          <span>{at('admin.photoRemoval.hint')}</span>
          <Input.TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={at('admin.field.reason')} maxLength={500} rows={3} />
        </Space>
      }
      onOpenChange={(open) => !open && setReason('')}
      okButtonProps={{ disabled: !reason.trim(), loading: remove.mutation.isPending }}
      onConfirm={() =>
        remove.mutate(
          { url: `/api/admin/photos/${photoId}`, method: 'delete', values: { reason }, errorNotification: false },
          {
            onSuccess: () => {
              setReason('')
              onDone()
            },
            onError: fail,
          },
        )
      }
    >
      <Button danger size="small" style={style}>
        {at('admin.action.deletePhoto')}
      </Button>
    </Popconfirm>
  )
}
