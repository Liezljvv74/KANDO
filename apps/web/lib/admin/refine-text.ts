import { t, type Key, type Lang } from '@kando/i18n'

// Refine's own texts (buttons, notifications, page titles) -> the back office catalogue.
const REFINE_KEYS = new Map<string, Key>(Object.entries({
  'buttons.logout': 'admin.signOut',
  'buttons.refresh': 'admin.action.refresh',
  'buttons.list': 'admin.action.list',
  'buttons.save': 'common.save',
  'buttons.cancel': 'common.cancel',
  'buttons.delete': 'common.delete',
  'buttons.edit': 'common.edit',
  'buttons.create': 'admin.action.create',
  'buttons.show': 'admin.action.show',
  'buttons.filter': 'admin.action.filter',
  'buttons.clear': 'admin.action.clear',
  'buttons.confirm': 'admin.action.confirm',
  'notifications.success': 'admin.notify.success',
  'notifications.error': 'admin.notify.error',
  'notifications.createSuccess': 'admin.notify.created',
  'notifications.editSuccess': 'admin.notify.edited',
  'notifications.deleteSuccess': 'admin.notify.deleted',
  'notifications.createError': 'admin.notify.createError',
  'notifications.editError': 'admin.notify.editError',
  'notifications.deleteError': 'admin.notify.deleteError',
} as Record<string, Key>))
const RESOURCES = new Map<string, Key>(Object.entries({
  documents: 'admin.resource.documents',
  users: 'admin.resource.users',
  providers: 'admin.resource.providers',
  categories: 'admin.resource.categories',
  pages: 'admin.resource.pages',
  staff: 'admin.resource.staff',
  flags: 'admin.resource.flags',
} as Record<string, Key>))
// Maps: a lookup never reaches an inherited property such as "constructor"
const ONES = new Map<string, Key>(Object.entries({ users: 'admin.one.users', providers: 'admin.one.providers', categories: 'admin.one.categories', documents: 'admin.one.documents', pages: 'admin.kind.page', staff: 'admin.one.staff', flags: 'admin.one.flags' } as Record<string, Key>))
const TITLES = new Map<string, Key>([['create', 'admin.title.create'], ['edit', 'admin.title.edit'], ['show', 'admin.title.show']])

/** Refine's `translate(key, options?, defaultMessage?)`; texts we do not know keep Refine's own default. */
export function refineText(lang: Lang, key: string, options?: unknown, defaultMessage?: string): string {
  const params = typeof options === 'object' && options ? (options as Record<string, string | number>) : {}
  const direct = REFINE_KEYS.get(key)
  if (direct) return t(lang, direct, params)
  const title = /^(\w+)\.titles\.(\w+)$/.exec(key) // "pages.titles.edit": the page title names the resource
  if (title) {
    const [, resource, kind] = title as unknown as [string, string, string]
    if (kind === 'list' && RESOURCES.has(resource)) return t(lang, RESOURCES.get(resource)!)
    if (TITLES.has(kind) && ONES.has(resource)) return t(lang, TITLES.get(kind)!, { item: t(lang, ONES.get(resource)!) })
  }
  const [a, b] = key.split('.')
  if (a && a === b && RESOURCES.has(a)) return t(lang, RESOURCES.get(a)!) // the resource's name inside a notification
  return typeof options === 'string' ? options : (defaultMessage ?? key)
}
