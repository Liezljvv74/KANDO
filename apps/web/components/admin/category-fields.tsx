'use client'

import { Form, Input, InputNumber, Select } from 'antd'
import { DOCUMENT_TYPES } from '@kando/contract'
import { useAt } from '../../lib/admin/t'

export function CategoryFields() {
  const at = useAt()
  const options = DOCUMENT_TYPES.map((value) => ({ value, label: at(`admin.requirement.${value}`) }))
  return (
    <>
      <Form.Item label={at('admin.field.slug')} name="slug" rules={[{ required: true, pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/ }]}>
        <Input />
      </Form.Item>
      <Form.Item label={at('admin.field.nameDe')} name={['names', 'de']} rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item label={at('admin.field.nameEn')} name={['names', 'en']}>
        <Input />
      </Form.Item>
      <Form.Item label={at('admin.field.sort')} name="sort">
        <InputNumber min={0} />
      </Form.Item>
      <Form.Item label={at('admin.field.requiredDocuments')} name="requiredDocuments">
        <Select mode="multiple" options={options} />
      </Form.Item>
      <Form.Item label={at('admin.field.optionalDocuments')} name="optionalDocuments">
        <Select mode="multiple" options={options} />
      </Form.Item>
    </>
  )
}
