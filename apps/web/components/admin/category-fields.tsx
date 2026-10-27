'use client'

import { Form, Input, InputNumber, Select } from 'antd'
import { useAt } from '../../lib/admin/t'

const REQUIREMENTS = ['police-certificate', 'permit']

export function CategoryFields() {
  const at = useAt()
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
        <Select mode="multiple" options={REQUIREMENTS.map((value) => ({ value, label: value }))} />
      </Form.Item>
    </>
  )
}
