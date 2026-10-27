import { eq } from 'drizzle-orm'
import { users } from '@kando/db'
import { MePatchSchema, parseBody } from '@kando/contract'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) => {
  const row = (await tx.select().from(users).where(eq(users.id, user!.id)))[0]!
  return Response.json({
    id: row.id,
    email: row.email,
    language: row.language,
    isProvider: row.isProvider,
    staffRole: row.staffRole,
  })
})

export const PATCH = appRequest({ auth: 'required', maxBodyBytes: 4096 }, async ({ tx, user, request }) => {
  const body = await parseBody(MePatchSchema, request)
  const row = (await tx.update(users).set({ ...body, updatedAt: new Date() }).where(eq(users.id, user!.id)).returning())[0]!
  return Response.json({ id: row.id, language: row.language, name: row.name })
})
