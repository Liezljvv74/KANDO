import { exportCsv, exportMyData } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

// ?format=json (default) or csv: both come from the same export object.
export const GET = appRequest({ auth: 'required' }, async ({ tx, user, request }) => {
  const format = new URL(request.url).searchParams.get('format') ?? 'json'
  if (format !== 'json' && format !== 'csv') return Response.json({ error: 'BAD_FORMAT' }, { status: 400 })
  const data = await exportMyData(tx, user!.id)
  // One line per export for the audit trail: who and when, never what.
  console.log(JSON.stringify({ event: 'data-export', userId: user!.id, at: data.exportedAt }))
  const headers = { 'Cache-Control': 'no-store' }
  if (format === 'csv') return new Response(exportCsv(data), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' } })
  return Response.json(data, { headers })
})
