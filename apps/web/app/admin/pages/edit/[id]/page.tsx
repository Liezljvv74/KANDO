'use client'

import { Edit, useForm } from '@refinedev/antd'
import { Form } from 'antd'
import { PageFields } from '../../../../../components/admin/page-fields'

export default function PageEdit() {
  const { formProps, saveButtonProps } = useForm()
  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <PageFields />
      </Form>
    </Edit>
  )
}
