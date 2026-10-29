'use client'

import { List, ShowButton, useTable } from '@refinedev/antd'
import { Table, Tag } from 'antd'
import { SearchForm, searchByText } from '../../../components/admin/search-form'
import { LOCALE } from '@kando/i18n'
import { useAdminLang, useAt } from '../../../lib/admin/t'

export default function FlagsList() {
  const at = useAt()
  const lang = useAdminLang()
  const { tableProps, searchFormProps } = useTable({ syncWithLocation: true, onSearch: searchByText })
  return (
    <List title={at('admin.resource.flags')}>
      <SearchForm formProps={searchFormProps} />
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="kind" title={at('admin.field.kind')} render={(k: string) => at(`admin.flag.kind.${k}` as 'admin.flag.kind.message-reported')} />
        <Table.Column dataIndex="concernedEmail" title={at('admin.field.user')} />
        <Table.Column dataIndex="reporterEmail" title={at('admin.field.reportedBy')} />
        <Table.Column dataIndex="createdAt" title={at('admin.field.createdAt')} sorter render={(v: string) => new Date(v).toLocaleString(LOCALE[lang])} />
        <Table.Column dataIndex="resolvedAt" title={at('admin.field.status')} render={(v: string | null) => (v ? <Tag color="green">{at('admin.flag.resolved')}</Tag> : <Tag color="orange">{at('admin.flag.open')}</Tag>)} />
        <Table.Column title="" render={(_, r: { id: string }) => <ShowButton hideText size="small" recordItemId={r.id} />} />
      </Table>
    </List>
  )
}
