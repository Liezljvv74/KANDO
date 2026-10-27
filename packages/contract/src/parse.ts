import type { z } from 'zod'

const invalid = (issues: z.core.$ZodIssue[]) =>
  Response.json({ error: 'Invalid input', issues }, { status: 400 })

/** The parsed JSON body; throws a 400 Response (`{ error: 'Invalid input', issues }`) when it does not fit. */
export async function parseBody<S extends z.ZodType>(
  schema: S,
  request: Request,
): Promise<z.output<S>> {
  const body: unknown = await request.json().catch(() => null)
  const result = schema.safeParse(body)
  if (!result.success) throw invalid(result.error.issues)
  return result.data
}

/** The parsed query string; throws a 400 Response the same way. */
export function parseQuery<S extends z.ZodType>(schema: S, request: Request): z.output<S> {
  const result = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!result.success) throw invalid(result.error.issues)
  return result.data
}
