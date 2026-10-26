import { sql } from 'drizzle-orm'
import type { Tx } from '@kando/db'

/** The requirements of a category that no approved document covers. */
export const missingDocuments = (required: string[], approved: Iterable<string>): string[] => {
  const have = new Set(approved)
  return required.filter((r) => !have.has(r))
}

/** Requirements with an approved document of the owner (under RLS: the caller's own documents). */
export async function approvedRequirements(tx: Tx, ownerId: string): Promise<Set<string>> {
  const { rows } = await tx.execute<{ requirement: string }>(
    sql`SELECT DISTINCT requirement FROM documents WHERE owner_id = ${ownerId} AND status = 'approved'`,
  )
  return new Set(rows.map((r) => r.requirement))
}

/**
 * Services of the provider whose category's required documents are all approved for the provider's owner.
 * Run as the owner: documents are private, so for anyone else every required document counts as missing.
 */
export async function offerableServiceIds(tx: Tx, providerId: string): Promise<string[]> {
  const { rows } = await tx.execute<{ id: string }>(sql`
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
