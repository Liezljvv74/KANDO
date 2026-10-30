import { describe, expect, it } from 'vitest'
import { de, en } from '@kando/i18n'
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
  })

  it('page titles name the resource in both languages (list, create, edit, show)', () => {
    expect(refineText('de', 'pages.titles.edit', 'Edit Page')).toBe('Seite bearbeiten')
    expect(refineText('en', 'pages.titles.edit', 'Edit Page')).toBe('Edit Page')
    expect(refineText('de', 'categories.titles.create', 'Create Category')).toBe('Kategorie anlegen')
    expect(refineText('de', 'users.titles.show', 'Show User')).toBe('Nutzerkonto ansehen')
    expect(refineText('en', 'users.titles.show', 'Show User')).toBe('View User account')
    expect(refineText('de', 'pages.titles.list', 'Pages')).toBe(de['admin.resource.pages'])
    expect(refineText('en', 'staff.titles.list', 'Staff')).toBe(en['admin.resource.staff'])
  })

  it('inherited object properties are not texts', () => {
    for (const key of ['constructor', 'toString', '__proto__', 'constructor.constructor', 'hasOwnProperty.titles.edit']) {
      expect(refineText('de', key, 'Default')).toBe('Default')
    }
    expect(refineText('de', 'constructor.titles.edit', 'Edit X')).toBe('Edit X')
  })

  it('an unknown text keeps the Refine default', () => {
    expect(refineText('de', 'something.else', 'Default')).toBe('Default')
    expect(refineText('de', 'something.else', {}, 'Default')).toBe('Default')
  })
})
