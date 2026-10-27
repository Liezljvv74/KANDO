import { sql } from 'drizzle-orm'
import type { db, Tx } from '@kando/db'

/**
 * Where eligibility is evaluated. The SQL functions below are SECURITY DEFINER (documents are private under RLS),
 * so any executor gives the same answer: the request's own `tx` is fine and needs no second connection.
 */
export type Exec = Tx | typeof db

/** Requirements of the service's category that the provider owner has no approved document for. */
export async function missingRequirements(exec: Exec, providerId: string, serviceId: string): Promise<string[]> {
  const { rows } = await exec.execute<{ r: string[] }>(sql`SELECT missing_requirements(${providerId}::uuid, ${serviceId}::uuid) AS r`)
  return rows[0]?.r ?? []
}

/** Services of the provider whose category's required documents are all approved for the provider's owner. */
export async function offerableServiceIds(exec: Exec, providerId: string): Promise<string[]> {
  const { rows } = await exec.execute<{ id: string }>(sql`SELECT offerable_service_ids(${providerId}::uuid) AS id`)
  return rows.map((r) => r.id)
}
