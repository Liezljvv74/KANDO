'use client'

import { Form, Input, Select, Switch } from 'antd'
import { useAt } from '../../lib/admin/t'

export function PageFields() {
  const at = useAt()
  return (
    <>
      <Form.Item label={at('admin.field.slug')} name="slug" rules={[{ required: true, pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/ }]}>
        <Input />
      </Form.Item>
      <Form.Item label={at('admin.field.kind')} name="kind" initialValue="page">
        <Select options={[{ value: 'page', label: at('admin.kind.page') }, { value: 'post', label: at('admin.kind.post') }]} />
      </Form.Item>
      <Form.Item label={at('admin.status.published')} name="published" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item label={at('admin.field.titleDe')} name={['texts', 'de', 'title']} rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item label={at('admin.field.bodyDe')} name={['texts', 'de', 'body']}>
        <Input.TextArea rows={12} />
      </Form.Item>
      <Form.Item label={at('admin.field.titleEn')} name={['texts', 'en', 'title']}>
        <Input />
      </Form.Item>
      <Form.Item label={at('admin.field.bodyEn')} name={['texts', 'en', 'body']}>
        <Input.TextArea rows={12} />
      </Form.Item>
    </>
  )
}
