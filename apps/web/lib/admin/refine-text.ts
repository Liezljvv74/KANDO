import { t, type Key, type Lang } from '@kando/i18n'

// Refine's own texts (buttons, notifications, page titles) -> the back office catalogue.
const REFINE_KEYS: Record<string, Key> = {
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
}
const RESOURCES: Record<string, Key> = {
  documents: 'admin.resource.documents',
  users: 'admin.resource.users',
  providers: 'admin.resource.providers',
  categories: 'admin.resource.categories',
  pages: 'admin.resource.pages',
  staff: 'admin.resource.staff',
}
const TITLES: Record<string, Key> = { create: 'admin.action.create', edit: 'common.edit' }

/** Refine's `translate(key, options?, defaultMessage?)`; texts we do not know keep Refine's own default. */
export function refineText(lang: Lang, key: string, options?: unknown, defaultMessage?: string): string {
  const params = typeof options === 'object' && options ? (options as Record<string, string | number>) : {}
  const known = REFINE_KEYS[key] ?? TITLES[/^\w+\.titles\.(\w+)$/.exec(key)?.[1] ?? '']
  if (known) return t(lang, known, params)
  const [a, b] = key.split('.')
  if (a && a === b && RESOURCES[a]) return t(lang, RESOURCES[a]) // the resource's name inside a notification
  return typeof options === 'string' ? options : (defaultMessage ?? key)
}
