import { sql } from 'drizzle-orm'
import type { db, Tx } from '@kando/db'

/**
 * Where eligibility is evaluated. Documents are private (RLS), so only the owner's own transaction sees them:
 * search and public pages (Task 7) must pass the owner connection (`db`), never an anonymous or other user's `tx`.
 */
export type Exec = Tx | typeof db

/** Requirements of the service's category that the provider owner has no approved document for. */
export async function missingRequirements(exec: Exec, providerId: string, serviceId: string): Promise<string[]> {
  const { rows } = await exec.execute<{ requirement: string }>(sql`
    SELECT r.requirement FROM services s
    JOIN categories c ON c.id = s.category_id
    JOIN providers p ON p.id = s.provider_id
    CROSS JOIN LATERAL unnest(c.required_documents) AS r(requirement)
    WHERE s.id = ${serviceId} AND s.provider_id = ${providerId}
      AND NOT EXISTS (
        SELECT 1 FROM documents d WHERE d.owner_id = p.owner_id AND d.requirement = r.requirement AND d.status = 'approved'
      )
    ORDER BY r.requirement`)
  return rows.map((r) => r.requirement)
}

/** Services of the provider whose category's required documents are all approved for the provider's owner. */
export async function offerableServiceIds(exec: Exec, providerId: string): Promise<string[]> {
  const { rows } = await exec.execute<{ id: string }>(sql`
    SELECT s.id FROM services s
    JOIN categories c ON c.id = s.category_id
    JOIN providers p ON p.id = s.provider_id
    WHERE s.provider_id = ${providerId}
      AND NOT EXISTS (
        SELECT 1 FROM unnest(c.required_documents) AS r(requirement)
        WHERE NOT EXISTS (
          SELECT 1 FROM documents d WHERE d.owner_id = p.owner_id AND d.requirement = r.requirement AND d.status = 'approved'
        )
      )
    ORDER BY s.created_at, s.id`)
  return rows.map((r) => r.id)
}
