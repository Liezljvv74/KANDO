import { t, type Key } from '@kando/i18n'

/** The back office is in German (the product's default language). */
export const at = (key: Key, params?: Record<string, string | number>) => t('de', key, params)
