'use client'

import { EditButton, List, useTable } from '@refinedev/antd'
import { Table } from 'antd'
import type { DocumentType } from '@kando/contract'
import { SearchForm, searchByText } from '../../../components/admin/search-form'
import { useAt } from '../../../lib/admin/t'

export default function CategoriesList() {
  const at = useAt()
  const docs = (d: DocumentType[]) => d.map((x) => at(`admin.requirement.${x}`)).join(', ')
  const { tableProps, searchFormProps } = useTable({ syncWithLocation: true, onSearch: searchByText })
  return (
    <List title={at('admin.resource.categories')}>
      <SearchForm formProps={searchFormProps} />
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="slug" title={at('admin.field.slug')} sorter />
        <Table.Column dataIndex={['names', 'de']} title={at('admin.field.nameDe')} />
        <Table.Column dataIndex={['names', 'en']} title={at('admin.field.nameEn')} />
        <Table.Column dataIndex="sort" title={at('admin.field.sort')} sorter />
        <Table.Column dataIndex="requiredDocuments" title={at('admin.field.requiredDocuments')} render={docs} />
        <Table.Column dataIndex="optionalDocuments" title={at('admin.field.optionalDocuments')} render={docs} />
        <Table.Column title="" render={(_, r: { id: string }) => <EditButton hideText size="small" recordItemId={r.id} />} />
      </Table>
    </List>
  )
}
