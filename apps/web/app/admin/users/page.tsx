'use client'

import { List, ShowButton, useTable } from '@refinedev/antd'
import { Table, Tag } from 'antd'
import { SearchForm, searchByText } from '../../../components/admin/search-form'
import { at } from '../../../lib/admin/t'

export default function UsersList() {
  const { tableProps, searchFormProps } = useTable({ syncWithLocation: true, onSearch: searchByText })
  return (
    <List title={at('admin.resource.users')}>
      <SearchForm formProps={searchFormProps} />
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="email" title={at('admin.field.email')} sorter />
        <Table.Column dataIndex="name" title={at('admin.field.name')} />
        <Table.Column dataIndex="staffRole" title={at('admin.field.role')} render={(r: string | null) => (r ? <Tag>{at(r === 'admin' ? 'admin.role.administrator' : 'admin.role.reviewer')}</Tag> : null)} />
        <Table.Column dataIndex="suspendedUntil" title={at('admin.field.suspendedUntil')} render={(v: string | null) => v && new Date(v).toLocaleDateString('de-DE')} />
        <Table.Column dataIndex="createdAt" title={at('admin.field.createdAt')} sorter render={(v: string) => new Date(v).toLocaleDateString('de-DE')} />
        <Table.Column title="" render={(_, r: { id: string }) => <ShowButton hideText size="small" recordItemId={r.id} />} />
      </Table>
    </List>
  )
}
