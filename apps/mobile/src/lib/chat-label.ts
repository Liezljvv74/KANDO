import { t } from '@/i18n'

/** The Open chat button's text: with the unread count when the chat has unread messages. */
export const chatLabel = (unread?: number) => (unread && unread > 0 ? t('chat.openUnread', { n: unread }) : t('chat.open'))
