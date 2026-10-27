'use client'

import type { FormProps } from 'antd'
import { Button, Form, Input, Space } from 'antd'
import { at } from '../../lib/admin/t'

/** The text filter above every list: `searchFormProps` from useTable (its onSearch turns `q` into the `q` filter). */
export function SearchForm({ formProps }: { formProps: FormProps<{ q?: string }> }) {
  return (
    <Form {...formProps} layout="inline" style={{ marginBottom: 16 }}>
      <Space>
        <Form.Item name="q" noStyle>
          <Input allowClear placeholder={at('admin.action.search')} />
        </Form.Item>
        <Button htmlType="submit" type="primary">
          {at('admin.action.filter')}
        </Button>
      </Space>
    </Form>
  )
}

export const searchByText = ({ q }: { q?: string }) => [{ field: 'q', operator: 'contains' as const, value: q }]
