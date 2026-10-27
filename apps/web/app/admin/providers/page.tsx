'use client'

import { List, ShowButton, useTable } from '@refinedev/antd'
import { Table, Tag } from 'antd'
import { SearchForm, searchByText } from '../../../components/admin/search-form'
import { useAt } from '../../../lib/admin/t'

export default function ProvidersList() {
  const at = useAt()
  const { tableProps, searchFormProps } = useTable({ syncWithLocation: true, onSearch: searchByText })
  return (
    <List title={at('admin.resource.providers')}>
      <SearchForm formProps={searchFormProps} />
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="displayName" title={at('admin.field.name')} sorter />
        <Table.Column dataIndex="ownerEmail" title={at('admin.field.owner')} />
        <Table.Column dataIndex="type" title={at('admin.field.type')} render={(r: string) => at(`admin.type.${r}` as 'admin.type.private')} />
        <Table.Column dataIndex="status" title={at('admin.field.status')} render={(s: string) => at(`admin.status.${s}` as 'admin.status.draft')} />
        <Table.Column dataIndex="suspended" title="" render={(s: boolean) => (s ? <Tag color="red">{at('admin.status.suspended')}</Tag> : null)} />
        <Table.Column title="" render={(_, r: { id: string }) => <ShowButton hideText size="small" recordItemId={r.id} />} />
      </Table>
    </List>
  )
}
