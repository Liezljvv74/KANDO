import { stopOffering } from '@kando/domain'
import { appRequest } from '@/lib/app-request'
import { refreshPublicPages } from '@/lib/public-cache'

export const POST = appRequest({ auth: 'required', allowWhenSuspended: true, allowStaleTerms: true }, async ({ tx, user }) => {
  const res = await stopOffering(tx, user!.id)
  if (res.hadProfile) refreshPublicPages('providers') // a customer without a profile cannot make every public page re-render
  return Response.json({ ok: true })
})
