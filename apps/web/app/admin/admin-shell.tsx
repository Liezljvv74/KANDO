'use client'

import { Suspense, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Authenticated, Refine, useGetIdentity } from '@refinedev/core'
import { ThemedLayout, RefineThemes, useNotificationProvider } from '@refinedev/antd'
import routerProvider from '@refinedev/nextjs-router'
import { App as AntdApp, Button, ConfigProvider, Layout as AntdLayout, theme } from 'antd'
import deDE from 'antd/locale/de_DE'
import enUS from 'antd/locale/en_US'
import '@refinedev/antd/dist/reset.css'
import { accessControlProvider, authProvider } from '../../lib/admin/auth-provider'
import { adminLangCookie } from '../../lib/admin/lang'
import { dataProvider } from '../../lib/admin/data-provider'
import { LANGS, t, type Key, type Lang } from '@kando/i18n'
import { AdminLangProvider, useAdminLang, useAt } from '../../lib/admin/t'

const locales: Record<Lang, typeof deDE> = { de: deDE, en: enUS }

// The Refine labels that show up in the sider and the List/Show headers.
const refineLabels: Record<string, Key> = {
  'buttons.logout': 'admin.signOut',
  'buttons.refresh': 'admin.action.refresh',
  'buttons.list': 'admin.action.list',
}

const otherLang = (lang: Lang) => LANGS.find((l) => l !== lang)!

// Language switch: one language per render, so set the cookie and reload.
function Header() {
  const { token } = theme.useToken()
  const at = useAt()
  const { data: user } = useGetIdentity()
  const lang = useAdminLang()
  return (
    <AntdLayout.Header
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: 16,
        padding: '0 24px',
        background: token.colorBgElevated,
      }}
    >
      <Button
        onClick={() => {
          document.cookie = adminLangCookie(otherLang(lang))
          location.reload()
        }}
      >
        {at('web.switchLang')}
      </Button>
      {user?.name && <strong>{user.name}</strong>}
    </AntdLayout.Header>
  )
}

// The root layout of the back office (the website has its own in app/(site)): a client component around <Refine>.
export default function AdminShell({ lang, children }: { lang: Lang; children: ReactNode }) {
  const at = (key: Key) => t(lang, key) // outside the provider below
  const resources = [
    {
      name: 'documents',
      list: '/admin/documents',
      show: '/admin/documents/show/:id',
      meta: { label: at('admin.resource.documents') },
    },
    {
      name: 'users',
      list: '/admin/users',
      show: '/admin/users/show/:id',
      meta: { label: at('admin.resource.users') },
    },
    {
      name: 'providers',
      list: '/admin/providers',
      show: '/admin/providers/show/:id',
      meta: { label: at('admin.resource.providers') },
    },
    {
      name: 'categories',
      list: '/admin/categories',
      create: '/admin/categories/create',
      edit: '/admin/categories/edit/:id',
      meta: { label: at('admin.resource.categories') },
    },
    {
      name: 'pages',
      list: '/admin/pages',
      create: '/admin/pages/create',
      edit: '/admin/pages/edit/:id',
      meta: { label: at('admin.resource.pages') },
    },
    { name: 'staff', list: '/admin/staff', meta: { label: at('admin.resource.staff') } },
  ]
  const signIn = usePathname() === '/admin/sign-in'
  return (
    <AdminLangProvider value={lang}>
      <Suspense>
        <ConfigProvider theme={RefineThemes.Blue} locale={locales[lang]}>
          <AntdApp>
            <Refine
              routerProvider={routerProvider}
              dataProvider={dataProvider}
              authProvider={authProvider}
              accessControlProvider={accessControlProvider}
              notificationProvider={useNotificationProvider}
              resources={resources}
              i18nProvider={{
                translate: (key: string, _options?: unknown, defaultMessage?: string) => {
                  const k = refineLabels[key]
                  return k ? t(lang, k) : (defaultMessage ?? key)
                },
                changeLocale: async () => {},
                getLocale: () => lang,
              }}
              options={{ syncWithLocation: true, disableTelemetry: true }}
            >
              {signIn ? (
                children
              ) : (
                <Authenticated key="admin">
                  <ThemedLayout Header={Header} Title={() => <strong>{at('admin.title')}</strong>}>
                    {children}
                  </ThemedLayout>
                </Authenticated>
              )}
            </Refine>
          </AntdApp>
        </ConfigProvider>
      </Suspense>
    </AdminLangProvider>
  )
}
