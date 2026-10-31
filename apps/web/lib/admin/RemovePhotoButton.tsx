'use client'

import { useState, type CSSProperties } from 'react'
import { useCustomMutation } from '@refinedev/core'
import { Button, Input, Popconfirm, Space } from 'antd'
import { useAt } from './t'

/** Staff remove a photo: a reason is required, and the person is emailed it (user and provider pages share this). */
export function RemovePhotoButton({ photoId, onDone, style }: { photoId: string; onDone: () => void; style?: CSSProperties }) {
  const at = useAt()
  const [reason, setReason] = useState('')
  const remove = useCustomMutation()
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
          { url: `/api/admin/photos/${photoId}`, method: 'delete', values: { reason } },
          {
            onSuccess: () => {
              setReason('')
              onDone()
            },
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
