import { exportMyData } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) => {
  const data = await exportMyData(tx, user!.id)
  // One line per export for the audit trail: who and when, never what.
  console.log(JSON.stringify({ event: 'data-export', userId: user!.id, at: data.exportedAt }))
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } })
})
