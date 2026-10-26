import { adminRequest } from '../../../../lib/admin-request'

export const GET = adminRequest('any', async ({ staff }) => Response.json(staff))
