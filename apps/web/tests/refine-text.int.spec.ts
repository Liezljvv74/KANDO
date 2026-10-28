import { describe, expect, it } from 'vitest'
import { en } from '@kando/i18n/src/en'
import { de } from '@kando/i18n/src/de'
import { refineText } from '../lib/admin/refine-text'

describe('Refine texts follow the admin language', () => {
  it.each([
    ['buttons.save', 'Save', en['common.save'], de['common.save']],
    ['buttons.create', 'Create', en['admin.action.create'], de['admin.action.create']],
    ['buttons.edit', 'Edit', en['common.edit'], de['common.edit']],
    ['buttons.delete', 'Delete', en['common.delete'], de['common.delete']],
    ['buttons.confirm', 'Are you sure?', en['admin.action.confirm'], de['admin.action.confirm']],
    ['notifications.success', 'Success', en['admin.notify.success'], de['admin.notify.success']],
  ])('%s', (key, refineDefault, english, german) => {
    // Refine calls translate(key, defaultMessage) or translate(key, options, defaultMessage)
    expect(refineText('de', key, refineDefault)).toBe(german)
    expect(refineText('en', key, undefined, refineDefault)).toBe(english)
    expect(german).not.toBe(refineDefault)
  })

  it('notifications carry the resource name and the status; create and edit pages get a translated title', () => {
    const resource = refineText('de', 'categories.categories', 'category')
    expect(resource).toBe(de['admin.resource.categories'])
    expect(refineText('de', 'notifications.createSuccess', { resource }, 'Successfully created category')).toBe(`Angelegt: ${resource}`)
    expect(refineText('en', 'notifications.editError', { resource: 'Pages', statusCode: 400 }, 'x')).toBe('Could not save: Pages (status 400)')
    expect(refineText('de', 'pages.titles.create', 'Create Page')).toBe(de['admin.action.create'])
  })

  it('an unknown text keeps the Refine default', () => {
    expect(refineText('de', 'something.else', 'Default')).toBe('Default')
    expect(refineText('de', 'something.else', {}, 'Default')).toBe('Default')
  })
})
