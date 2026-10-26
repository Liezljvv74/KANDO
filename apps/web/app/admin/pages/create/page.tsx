'use client'

import { Create, useForm } from '@refinedev/antd'
import { Form } from 'antd'
import { PageFields } from '../../../../components/admin/page-fields'

export default function PageCreate() {
  const { formProps, saveButtonProps } = useForm()
  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <PageFields />
      </Form>
    </Create>
  )
}
