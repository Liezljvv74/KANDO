'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLogin, useLogout } from '@refinedev/core'
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import { useAt } from '../../../lib/admin/t'

function SignIn() {
  const at = useAt()
  const denied = useSearchParams().get('denied') === '1'
  const login = useLogin<{ email: string; password: string }>()
  const logout = useLogout()
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '10vh 16px' }}>
      <Card style={{ width: 380, maxWidth: '100%' }}>
        {denied ? (
          // Signed in, but no staff role: no data, only a way out.
          <>
            <Typography.Title level={4}>{at('admin.noAccess')}</Typography.Title>
            <Typography.Paragraph>{at('admin.noAccess.body')}</Typography.Paragraph>
            <Button onClick={() => logout.mutate()}>{at('admin.signOut')}</Button>
          </>
        ) : (
          <>
            <Typography.Title level={4}>{at('admin.signIn.title')}</Typography.Title>
            {login.error && <Alert type="error" message={login.error.message} style={{ marginBottom: 16 }} />}
            <Form layout="vertical" onFinish={(v) => login.mutate(v)}>
              <Form.Item label={at('common.email')} name="email" rules={[{ required: true, type: 'email' }]}>
                <Input autoComplete="username" />
              </Form.Item>
              <Form.Item label={at('common.password')} name="password" rules={[{ required: true }]}>
                <Input.Password autoComplete="current-password" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={login.isPending}>
                {at('admin.signIn.submit')}
              </Button>
            </Form>
          </>
        )}
      </Card>
    </div>
  )
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  )
}
