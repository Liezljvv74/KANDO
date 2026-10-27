'use client'

import { Suspense, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Authenticated, Refine } from '@refinedev/core'
import { ThemedLayout, RefineThemes, useNotificationProvider } from '@refinedev/antd'
import routerProvider from '@refinedev/nextjs-router'
import { App as AntdApp, ConfigProvider } from 'antd'
import deDE from 'antd/locale/de_DE'
import '@refinedev/antd/dist/reset.css'
import { accessControlProvider, authProvider } from '../../lib/admin/auth-provider'
import { dataProvider } from '../../lib/admin/data-provider'
import { at } from '../../lib/admin/t'

const resources = [
  { name: 'documents', list: '/admin/documents', show: '/admin/documents/show/:id', meta: { label: at('admin.resource.documents') } },
  { name: 'users', list: '/admin/users', show: '/admin/users/show/:id', meta: { label: at('admin.resource.users') } },
  { name: 'providers', list: '/admin/providers', show: '/admin/providers/show/:id', meta: { label: at('admin.resource.providers') } },
  {
    name: 'categories',
    list: '/admin/categories',
    create: '/admin/categories/create',
    edit: '/admin/categories/edit/:id',
    meta: { label: at('admin.resource.categories') },
  },
  { name: 'pages', list: '/admin/pages', create: '/admin/pages/create', edit: '/admin/pages/edit/:id', meta: { label: at('admin.resource.pages') } },
  { name: 'staff', list: '/admin/staff', meta: { label: at('admin.resource.staff') } },
]

// The root layout of the back office (the website has its own in app/(site)): a client component around <Refine>.
export default function AdminLayout({ children }: { children: ReactNode }) {
  const signIn = usePathname() === '/admin/sign-in'
  return (
    <html lang="de">
      <body>
        <Suspense>
          <ConfigProvider theme={RefineThemes.Blue} locale={deDE}>
            <AntdApp>
              <Refine
                routerProvider={routerProvider}
                dataProvider={dataProvider}
                authProvider={authProvider}
                accessControlProvider={accessControlProvider}
                notificationProvider={useNotificationProvider}
                resources={resources}
                options={{ syncWithLocation: true, disableTelemetry: true }}
              >
                {signIn ? (
                  children
                ) : (
                  <Authenticated key="admin">
                    <ThemedLayout Title={() => <strong>{at('admin.title')}</strong>}>{children}</ThemedLayout>
                  </Authenticated>
                )}
              </Refine>
            </AntdApp>
          </ConfigProvider>
        </Suspense>
      </body>
    </html>
  )
}
