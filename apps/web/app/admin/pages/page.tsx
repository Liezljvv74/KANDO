'use client'

import { EditButton, List, useTable } from '@refinedev/antd'
import { Table, Tag } from 'antd'
import { SearchForm, searchByText } from '../../../components/admin/search-form'
import { useAt } from '../../../lib/admin/t'

export default function PagesList() {
  const at = useAt()
  const { tableProps, searchFormProps } = useTable({ syncWithLocation: true, onSearch: searchByText })
  return (
    <List title={at('admin.resource.pages')}>
      <SearchForm formProps={searchFormProps} />
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="slug" title={at('admin.field.slug')} sorter />
        <Table.Column dataIndex={['texts', 'de', 'title']} title={at('admin.field.titleDe')} />
        <Table.Column dataIndex="kind" title={at('admin.field.kind')} render={(k: string) => at(`admin.kind.${k}` as 'admin.kind.page')} />
        <Table.Column dataIndex="published" title={at('admin.status.published')} render={(p: boolean) => <Tag color={p ? 'green' : 'default'}>{at(p ? 'admin.status.published' : 'admin.status.draft')}</Tag>} />
        <Table.Column title="" render={(_, r: { id: string }) => <EditButton hideText size="small" recordItemId={r.id} />} />
      </Table>
    </List>
  )
}
