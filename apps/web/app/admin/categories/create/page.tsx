'use client'

import { Create, useForm } from '@refinedev/antd'
import { Form } from 'antd'
import { CategoryFields } from '../../../../components/admin/category-fields'

export default function CategoryCreate() {
  const { formProps, saveButtonProps } = useForm()
  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <CategoryFields />
      </Form>
    </Create>
  )
}
