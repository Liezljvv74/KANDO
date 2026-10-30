import { createAppRequest } from '@kando/domain'
import { afterResponse } from './after-response'
import { sessionFromRequest } from './auth/server'

export const appRequest = createAppRequest(sessionFromRequest, { schedule: afterResponse })
