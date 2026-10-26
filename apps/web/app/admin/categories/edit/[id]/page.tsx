'use client'

import { Edit, useForm } from '@refinedev/antd'
import { Form } from 'antd'
import { CategoryFields } from '../../../../../components/admin/category-fields'

export default function CategoryEdit() {
  const { formProps, saveButtonProps } = useForm()
  return (
    <Edit saveButtonProps={saveButtonProps} canDelete={false}>
      <Form {...formProps} layout="vertical">
        <CategoryFields />
      </Form>
    </Edit>
  )
}
