import type { PushSettings } from '@kando/contract'

import { api } from '@/api/client'

const TOKENS = '/app-api/v1/push-tokens'
const SETTINGS = '/app-api/v1/me/push'

export const savePushToken = (token: string, platform: 'ios' | 'android') => api<null>(TOKENS, { method: 'POST', body: { token, platform } })
/** The token goes in the body, never the URL. */
export const removePushToken = (token: string) => api<null>(TOKENS, { method: 'DELETE', body: { token } })

export const getPushSettings = () => api<PushSettings>(SETTINGS)
export const setPushSettings = (patch: Partial<PushSettings>) => api<PushSettings>(SETTINGS, { method: 'PATCH', body: patch })
