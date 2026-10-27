'use client'

import { List, ShowButton, useTable } from '@refinedev/antd'
import { Table, Tag } from 'antd'
import { SearchForm, searchByText } from '../../../components/admin/search-form'
import { useAt } from '../../../lib/admin/t'

export default function DocumentsList() {
  const at = useAt()
  const { tableProps, searchFormProps } = useTable({ syncWithLocation: true, onSearch: searchByText })
  return (
    <List title={at('admin.resource.documents')}>
      <SearchForm formProps={searchFormProps} />
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="ownerEmail" title={at('admin.field.email')} />
        <Table.Column dataIndex="requirement" title={at('admin.field.requirement')} render={(r: string) => at(`admin.requirement.${r}` as 'admin.requirement.permit')} />
        <Table.Column dataIndex="status" title={at('admin.field.status')} render={(s: string) => <Tag color={s === 'pending' ? 'orange' : s === 'approved' ? 'green' : 'red'}>{at(`admin.status.${s}` as 'admin.status.pending')}</Tag>} />
        <Table.Column dataIndex="createdAt" title={at('admin.field.createdAt')} render={(v: string) => new Date(v).toLocaleString('de-DE')} />
        <Table.Column title="" render={(_, r: { id: string }) => <ShowButton hideText size="small" recordItemId={r.id} />} />
      </Table>
    </List>
  )
}
