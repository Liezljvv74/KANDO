import { existsSync, readFileSync } from 'node:fs'
import { and, eq, sql } from 'drizzle-orm'
import type { ProfileInput, ReferenceInput } from '@kando/contract'
import type { Lang } from '@kando/i18n'
import { asUser, categories, db, providers, services, users } from '@kando/db'
import { assertDevTarget } from '@kando/db/src/seed/guard'
import { addReference, addService } from '../providers/items'
import { publish, upsertMyProfile } from '../providers/profile'
import { givePlaceholderPhoto } from './placeholder-photos'

type Service = { category: string; title: string; description: string; priceType: 'fixed' | 'hourly' | 'from' | 'on-request'; price?: number }
type Account = { email: string; name: string; language?: Lang }
type Provider = Account & { profile: ProfileInput; services: Service[]; references?: ReferenceInput[] }
export type SeedData = { password: string; customers: Account[]; providers: Provider[] }

const DATA_DIR = new URL('../../seed-data/', import.meta.url)
/** The real account list is git-ignored (`seed-data/test-users.json`); the committed example is the fallback. */
export function loadSeedData(file: string | URL | undefined = process.env.SEED_USERS_FILE): SeedData {
  const path = file ?? [new URL('test-users.json', DATA_DIR), new URL('test-users.example.json', DATA_DIR)].find((u) => existsSync(u))!
  const data = JSON.parse(readFileSync(path, 'utf8')) as SeedData
  if (!data.password || !Array.isArray(data.customers) || !Array.isArray(data.providers)) throw new Error(`Seed data ${path} needs password, customers and providers`)
  return data
}

/** Creates an auth account (or, when the email exists, signs into it) and returns its id. */
export type TestAuth = { signUp(email: string, password: string, name: string): Promise<{ id: string }> }

/** Neon Auth over REST. Never logs the password or tokens. */
export function neonAuth(baseUrl: string, retryDelayMs = 2000): TestAuth {
  const url = (path: string) => `${baseUrl.replace(new RegExp('/+$'), '')}/${path}`
  // A rate-limited or failing call (429, 5xx) is retried a few times, slowly.
  const post = async (path: string, body: object) => {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        body: JSON.stringify(body),
      })
      if ((res.status !== 429 && res.status < 500) || attempt === 4) return res
      await new Promise((r) => setTimeout(r, retryDelayMs * attempt))
    }
  }
  const userId = async (res: Response) => ((await res.json().catch(() => null)) as { user?: { id?: string } } | null)?.user?.id
  return {
    async signUp(email, password, name) {
      const up = await post('sign-up/email', { email, password, name })
      const upBody = up.ok ? null : await up.clone().json().catch(() => null)
      if (!up.ok && !String((upBody as { code?: string } | null)?.code ?? '').startsWith('USER_ALREADY_EXISTS')) {
        throw new Error(`Neon Auth sign-up failed for ${email} (HTTP ${up.status})`)
      }
      const res = up.ok ? up : await post('sign-in/email', { email, password }) // email taken: the account exists already
      const id = await userId(res)
      if (!res.ok || !id) throw new Error(`Neon Auth ${up.ok ? 'sign-up' : 'sign-in'} gave no account for ${email} (HTTP ${res.status})`)
      return { id }
    },
  }
}

/** The app treats an unverified email as signed out, so the dev accounts are marked verified in the Neon Auth schema. */
async function markVerified(email: string): Promise<void> {
  await db.execute(sql`UPDATE neon_auth."user" SET "emailVerified" = true WHERE email = ${email}`)
}

/** One account: auth, users row, and for a provider the profile, services, references and photo through the domain, published. */
export async function buildTestUser(auth: TestAuth, a: Account | Provider, categoryIds: Map<string, string>, password: string): Promise<boolean> {
  const { id } = await auth.signUp(a.email, password, a.name)
  const existing = (await db.select({ id: users.id }).from(users).where(eq(users.id, id)))[0]
  await markVerified(a.email) // also for accounts that already exist, so a rerun fixes them
  // Only a published provider counts as done, so a crashed run resumes.
  const done = existing && (await db.select({ id: providers.id }).from(providers).where(and(eq(providers.ownerId, id), eq(providers.status, 'published')))).length > 0
  if (existing && (done || !('profile' in a))) return false
  if (!existing) await db.insert(users).values({ id, email: a.email, name: a.name, language: a.language ?? 'de' })
  if (!('profile' in a)) return true
  await asUser(id, async (tx) => {
    const { profile } = await upsertMyProfile(tx, id, a.profile)
    // Services and references are added in this one transaction: a provider that has services has both (a run that
    // crashed later, at the photo, resumes from there).
    if ((await tx.select({ id: services.id }).from(services).where(eq(services.providerId, profile.id)).limit(1)).length) return
    for (const s of a.services) {
      await addService(tx, id, {
        categoryId: categoryIds.get(s.category)!,
        title: s.title,
        description: s.description,
        priceType: s.priceType,
        price: s.priceType === 'on-request' ? null : s.price!,
        currency: 'EUR',
      })
    }
    for (const r of a.references ?? []) await addReference(tx, id, r)
  })
  await givePlaceholderPhoto(id, a.profile.businessName ?? a.name)
  await asUser(id, (tx) => publish(tx, id))
  return true
}

/** All test accounts; skips the ones that exist. Needs the categories and the postcodes imported. */
export async function seedTestUsers(auth: TestAuth, env: Record<string, string | undefined> = process.env, data: SeedData = loadSeedData()): Promise<{ created: number; skipped: number }> {
  assertDevTarget(env)
  const categoryIds = new Map((await db.select({ id: categories.id, slug: categories.slug }).from(categories)).map((c) => [c.slug, c.id]))
  const missing = [...new Set(data.providers.flatMap((p) => p.services.map((s) => s.category)))].filter((s) => !categoryIds.has(s))
  if (missing.length) throw new Error(`Unknown categories: ${missing.join(', ')}; run pnpm db:seed:categories first`)
  let created = 0
  let skipped = 0
  for (const a of [...data.customers, ...data.providers]) {
    if (await buildTestUser(auth, a, categoryIds, data.password)) created++
    else skipped++
  }
  return { created, skipped }
}
