import { chatLabel } from './chat-label'

jest.mock('@/i18n', () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? [key, ...Object.values(p)].join(' ') : key) }))

it('plain label without unread, with the count when unread', () => {
  expect(chatLabel()).toBe('chat.open')
  expect(chatLabel(0)).toBe('chat.open')
  expect(chatLabel(1)).toBe('chat.openUnread 1')
})
