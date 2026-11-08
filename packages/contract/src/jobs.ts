import { z } from 'zod'
import { JobStateSchema } from './bookings'
import { CursorSchema } from './common'

export const JOB_SECTIONS = ['needs_you', 'active', 'past'] as const

/** GET /jobs: `?role=&section=&q=&cursor=`. With `q` the search covers all sections of the role (section is ignored). */
export const JobsQuerySchema = z.object({
  role: z.enum(['customer', 'provider']).default('customer'),
  section: z.enum(JOB_SECTIONS).default('needs_you'),
  q: z.string().trim().min(1).max(100).optional(),
  cursor: CursorSchema.optional(),
})
export type JobsQuery = z.infer<typeof JobsQuerySchema>

/** One job (the root request) in the Jobs list, as the caller sees it in the asked role. */
export const JobRowSchema = z.object({
  /** The root request's id (the job page opens it). */
  id: z.string(),
  /** The job number, shown as `#1044`. */
  number: z.number().int(),
  title: z.string(),
  otherParty: z.string(),
  /** The current booking's start, else the request's wished time, else when it was made. */
  date: z.string(),
  jobState: JobStateSchema,
  /** 1 when the job's chat has an unread message (per job, not per message). */
  unread: z.number().int().min(0),
})
export type JobRow = z.infer<typeof JobRowSchema>

/** A page of one section (or of a search), latest job date first; `counts` are jobs, each counted once, for the asked role only. */
export const JobsPageSchema = z.object({
  items: z.array(JobRowSchema),
  next: z.string().optional(),
  counts: z.object({
    /** Jobs that add to the role's counter: in "Needs you", or with an unread message. */
    needsYou: z.number().int().min(0),
    /** Jobs with an unread message. */
    unread: z.number().int().min(0),
    /** All past jobs of the role ("Past jobs (n)"); optional so an older server still parses. */
    past: z.number().int().min(0).optional(),
  }),
})
export type JobsPage = z.infer<typeof JobsPageSchema>
