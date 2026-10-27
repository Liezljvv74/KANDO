'use client'

import { useCustomMutation } from '@refinedev/core'
import { List, useTable } from '@refinedev/antd'
import { Button, Form, Input, Select, Space, Table, Tag } from 'antd'
import { useAt } from '../../../lib/admin/t'

export default function StaffList() {
  const at = useAt()
  const { tableProps, tableQuery } = useTable({ syncWithLocation: true })
  const set = useCustomMutation()
  return (
    <List title={at('admin.resource.staff')} canCreate={false}>
      <Form
        layout="inline"
        style={{ marginBottom: 16 }}
        initialValues={{ staffRole: 'reviewer' }}
        onFinish={(v: { email: string; staffRole: string }) =>
          set.mutate({ url: '/api/admin/staff', method: 'patch', values: { email: v.email, staffRole: v.staffRole === 'none' ? null : v.staffRole } }, { onSuccess: () => tableQuery.refetch() })
        }
      >
        <Space wrap>
          <Form.Item name="email" rules={[{ required: true, type: 'email' }]} noStyle>
            <Input placeholder={at('admin.field.email')} style={{ width: 280 }} />
          </Form.Item>
          <Form.Item name="staffRole" noStyle>
            <Select
              style={{ width: 200 }}
              options={[
                { value: 'admin', label: at('admin.role.administrator') },
                { value: 'reviewer', label: at('admin.role.reviewer') },
                { value: 'none', label: at('admin.staff.noRole') },
              ]}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={set.mutation.isPending}>
            {at('admin.action.setRole')}
          </Button>
        </Space>
      </Form>
      <p>{at('admin.staff.hint')}</p>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="email" title={at('admin.field.email')} />
        <Table.Column dataIndex="name" title={at('admin.field.name')} />
        <Table.Column dataIndex="staffRole" title={at('admin.field.role')} render={(r: string) => <Tag>{at(r === 'admin' ? 'admin.role.administrator' : 'admin.role.reviewer')}</Tag>} />
      </Table>
    </List>
  )
}
