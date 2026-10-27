import { db } from '@kando/db'
import { staffAllows, type StaffRole, type StaffUser } from '@kando/domain'
import { getAuth } from './auth/server'

/** For /api/admin/*: the signed-in staff user, or throws a 401/403 Response. Runs on the owner connection. */
export async function requireStaff(role: StaffRole | 'any'): Promise<StaffUser> {
  const { data: session } = await getAuth().getSession()
  if (!session?.user) throw Response.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, session.user.id) })
  const suspended = !!row?.suspendedUntil && row.suspendedUntil > new Date()
  if (!row || suspended || !staffAllows(row.staffRole, role)) throw Response.json({ error: 'Forbidden' }, { status: 403 })
  return { id: row.id, email: row.email, staffRole: row.staffRole as StaffRole }
}
