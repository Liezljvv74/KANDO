import { eq } from 'drizzle-orm'
import { users } from '@kando/db'
import { isLang } from '@kando/i18n'
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

// ponytail: hand-checked body; parseBody with a contract schema (Task 4) replaces this.
export const PATCH = appRequest({ auth: 'required', maxBodyBytes: 4096 }, async ({ tx, user, request }) => {
  const body = (await request.json().catch(() => null)) as { language?: unknown; name?: unknown } | null
  if (!body || typeof body !== 'object') return Response.json({ error: 'Invalid body' }, { status: 400 })
  const patch: { language?: string; name?: string; updatedAt: Date } = { updatedAt: new Date() }
  if (body.language !== undefined) {
    if (!isLang(body.language)) return Response.json({ error: 'Invalid language' }, { status: 400 })
    patch.language = body.language
  }
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.length > 100) {
      return Response.json({ error: 'Invalid name' }, { status: 400 })
    }
    patch.name = body.name
  }
  const row = (await tx.update(users).set(patch).where(eq(users.id, user!.id)).returning())[0]!
  return Response.json({ id: row.id, language: row.language, name: row.name })
})
