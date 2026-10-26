import { createAppRequest } from '@kando/domain'
import { sessionFromRequest } from './auth/server'

export const appRequest = createAppRequest(sessionFromRequest)
