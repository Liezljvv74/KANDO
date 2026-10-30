import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import { sql } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { assertTestDatabase } from '@kando/db/src/test/guard'
import { applyRls, asUser, classifyTables, db, migrate, pool } from '@kando/db'
import { adminGet, getMyProfile } from '@kando/domain'

it('migrates an empty database and classifies every table', async () => {
  assertTestDatabase(pool.options.connectionString!)
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE')
  await migrate()
  expect(classifyTables()).toEqual({ unclassified: [], duplicated: [] })
  const { rows } = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'app_user'")
  expect(rows).toHaveLength(1)
  await migrate() // idempotent
}, 30_000)

const columns = async (table: string) =>
  Object.fromEntries(
    (
      await pool.query(
        "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
        [table],
      )
    ).rows.map((r) => [r.column_name, r.is_nullable === 'YES']),
  )

it('0008: person fields on users, suspensions by date, drafts allowed, notifications; applyRls succeeds', async () => {
  const users = await columns('users')
  for (const c of ['first_name', 'last_name', 'address_street', 'address_postcode', 'address_city', 'address_country']) expect(users[c], c).toBe(true)
  expect(users).not.toHaveProperty('name')
  const providers = await columns('providers')
  expect(providers.suspended_until).toBe(true)
  expect(providers.type).toBe(true)
  for (const c of ['display_name', 'photo_id', 'suspended']) expect(providers, c).not.toHaveProperty(c)
  const services = await columns('services')
  expect([services.price_type, services.price]).toEqual([true, true])
  expect((await columns('photos')).provider_id).toBe(true)
  expect(Object.keys(await columns('notifications')).sort()).toEqual(
    ['created_at', 'dismissed_at', 'id', 'kind', 'payload', 'seen_at', 'user_id'].sort(),
  )
  await expect(applyRls()).resolves.toBeUndefined() // a function still reading a dropped column fails here
})

it('photos: a profile photo has no provider, a portfolio photo has one, one profile photo per person', async () => {
  await pool.query("INSERT INTO users (id, email) VALUES ('dm-1', 'dm-1@test.skilled.invalid')")
  const pid = (await pool.query("INSERT INTO providers (owner_id) VALUES ('dm-1') RETURNING id")).rows[0].id
  const photo = (providerId: string | null, kind: string) =>
    pool.query("INSERT INTO photos (owner_id, provider_id, kind, key, width, height) VALUES ('dm-1', $1, $2, 'k', 1, 1)", [providerId, kind])
  try {
    await expect(photo(pid, 'profile')).rejects.toThrow(/photos_profile_provider_check/)
    await expect(photo(null, 'portfolio')).rejects.toThrow(/photos_profile_provider_check/)
    await photo(null, 'profile')
    await expect(photo(null, 'profile')).rejects.toThrow(/photos_one_profile_idx/)
    await photo(pid, 'portfolio')
  } finally {
    await pool.query("DELETE FROM photos WHERE owner_id = 'dm-1'")
    await pool.query("DELETE FROM providers WHERE owner_id = 'dm-1'")
    await pool.query("DELETE FROM users WHERE id = 'dm-1'")
  }
})

it('0008 on a database with data: a suspended provider stays hidden, a published one without names or picture goes back to draft', async () => {
  assertTestDatabase(pool.options.connectionString!)
  const src = join(process.cwd(), '../../packages/db/migrations')
  const upTo7 = mkdtempSync(join(tmpdir(), 'mig7-'))
  cpSync(src, upTo7, { recursive: true })
  const journalPath = join(upTo7, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  journal.entries = journal.entries.filter((e: { tag: string }) => e.tag < '0008')
  writeFileSync(journalPath, JSON.stringify(journal))
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE')
  await drizzleMigrate(db, { migrationsFolder: upTo7 })
  await pool.query(`INSERT INTO users (id, email, suspended_until) VALUES
    ('m8-pub', 'm8-pub@test.skilled.invalid', NULL),
    ('m8-sus', 'm8-sus@test.skilled.invalid', now() + interval '5 days'),
    ('m8-susnodate', 'm8-susnodate@test.skilled.invalid', NULL),
    ('m8-draft', 'm8-draft@test.skilled.invalid', NULL)`)
  await pool.query(`INSERT INTO providers (owner_id, type, display_name, status, suspended) VALUES
    ('m8-pub', 'private', 'P', 'published', false),
    ('m8-sus', 'private', 'S', 'published', true),
    ('m8-susnodate', 'private', 'N', 'published', true),
    ('m8-draft', 'private', 'D', 'draft', false)`)
  const pid = (await pool.query("SELECT id FROM providers WHERE owner_id = 'm8-pub'")).rows[0].id
  await pool.query("INSERT INTO photos (owner_id, provider_id, kind, key, width, height) VALUES ('m8-pub', $1, 'profile', 'k', 1, 1)", [pid])
  await migrate()
  const rows = (await pool.query("SELECT owner_id, status, suspended_until, suspended_until > now() + interval '365 days' AS for_good FROM providers WHERE owner_id LIKE 'm8-%' ORDER BY owner_id")).rows
  const by = Object.fromEntries(rows.map((r) => [r.owner_id, r]))
  expect(by['m8-sus'].suspended_until.getTime()).toBeGreaterThan(Date.now() + 4 * 86_400_000) // the owner's end date carried over
  expect(by['m8-susnodate'].for_good).toBe(true) // no date known: still hidden
  expect(by['m8-pub'].suspended_until).toBeNull()
  expect(rows.map((r) => r.status)).toEqual(['draft', 'draft', 'draft', 'draft']) // no names, no pictures after the migration
  // the legacy rows go through the domain mappers: a date Node cannot read would throw here
  for (const id of ['m8-sus', 'm8-susnodate']) {
    expect((await asUser(id, (tx) => getMyProfile(tx, id)))!.suspendedUntil).toEqual(expect.any(String))
    const pid = (await pool.query('SELECT id FROM providers WHERE owner_id = $1', [id])).rows[0].id
    const res = await db.transaction((tx) => adminGet(tx, 'providers', pid) as Promise<Response>)
    expect(res.status).toBe(200)
    expect(new Date((await res.json()).data.suspendedUntil).getTime()).toBeGreaterThan(Date.now())
  }
  // still suspended: published and complete it stays hidden from the public, an unsuspended one is visible
  await pool.query("UPDATE providers SET status = 'published', slug = owner_id WHERE owner_id IN ('m8-pub', 'm8-sus', 'm8-susnodate')")
  const visible = await asUser(null, (tx) => tx.execute(sql`SELECT slug FROM providers WHERE owner_id LIKE 'm8-%'`))
  expect(visible.rows.map((r) => r.slug)).toEqual(['m8-pub'])
  await pool.query("DELETE FROM providers WHERE owner_id LIKE 'm8-%'")
  await pool.query("DELETE FROM users WHERE id LIKE 'm8-%'")
}, 60_000)

it('0017 on a database with data: accepted_at and request_id backfilled, an awaiting-payment row without pay_by gets one, money columns empty', async () => {
  assertTestDatabase(pool.options.connectionString!)
  const upTo16 = mkdtempSync(join(tmpdir(), 'mig16-'))
  cpSync(join(process.cwd(), '../../packages/db/migrations'), upTo16, { recursive: true })
  const journalPath = join(upTo16, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  journal.entries = journal.entries.filter((e: { tag: string }) => e.tag < '0017')
  writeFileSync(journalPath, JSON.stringify(journal))
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE')
  await drizzleMigrate(db, { migrationsFolder: upTo16 })
  await pool.query("INSERT INTO users (id, email) VALUES ('m17-c', 'm17-c@test.skilled.invalid'), ('m17-p', 'm17-p@test.skilled.invalid')")
  const p = (await pool.query("INSERT INTO providers (owner_id, status) VALUES ('m17-p', 'published') RETURNING id")).rows[0].id
  const r = (await pool.query("INSERT INTO requests (customer_id, provider_id, description, answer_by, status) VALUES ('m17-c', $1, 'x', now(), 'booked') RETURNING id", [p])).rows[0].id
  const q = (await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at, status) VALUES ($1, $2, 80, 's', now(), 'accepted') RETURNING id", [r, p])).rows[0].id
  const booking = async (status: string, quote: string | null, payBy: string | null) =>
    (await pool.query("INSERT INTO bookings (customer_id, provider_id, quote_id, source, status, start_at, duration_min, amount, pay_by, updated_at) VALUES ('m17-c', $1, $2, $3, $4, now() + interval '9 days', 60, 80, $5, '2026-10-01T10:00:00Z') RETURNING id", [p, quote, quote ? 'quote' : 'direct', status, payBy])).rows[0].id as string
  const paying = await booking('awaiting-payment', q, '2026-10-03T10:00:00Z')
  const noDeadline = await booking('awaiting-payment', null, null)
  const proposed = await booking('proposed', null, null)
  await pool.query("INSERT INTO notifications (user_id, kind) VALUES ('m17-c', 'booking-accepted')")
  await migrate()
  const rows = Object.fromEntries((await pool.query('SELECT id, accepted_at, request_id, pay_by, amount, commission_rate, payment_ref, paid_at FROM bookings')).rows.map((b) => [b.id, b]))
  expect(rows[paying]).toMatchObject({ accepted_at: new Date('2026-10-01T10:00:00Z'), request_id: r, pay_by: new Date('2026-10-03T10:00:00Z'), amount: '80.00', commission_rate: null, payment_ref: null, paid_at: null })
  expect(rows[noDeadline]).toMatchObject({ accepted_at: new Date('2026-10-01T10:00:00Z'), pay_by: new Date('2026-10-01T10:00:00Z'), request_id: null }) // lapses at the next sweep
  expect(rows[proposed]).toMatchObject({ accepted_at: null, pay_by: null })
  expect((await pool.query("SELECT stripe_account_id, payouts_ready_at FROM providers WHERE owner_id = 'm17-p'")).rows).toEqual([{ stripe_account_id: null, payouts_ready_at: null }])
  // the existing rows still satisfy every check, and the new kinds are accepted
  await pool.query("INSERT INTO notifications (user_id, kind) VALUES ('m17-c', 'payment-received')")
  await pool.query("INSERT INTO staff_flags (kind, ref_id) VALUES ('chargeback', $1)", [paying])
  await pool.query('DELETE FROM staff_flags; DELETE FROM notifications; DELETE FROM bookings; DELETE FROM quotes; DELETE FROM requests; DELETE FROM providers; DELETE FROM users')
}, 60_000)

it('0018 on a database with data: existing bookings keep their status and get safe defaults; the new statuses and kinds are accepted', async () => {
  assertTestDatabase(pool.options.connectionString!)
  const upTo17 = mkdtempSync(join(tmpdir(), 'mig17-'))
  cpSync(join(process.cwd(), '../../packages/db/migrations'), upTo17, { recursive: true })
  const journalPath = join(upTo17, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  journal.entries = journal.entries.filter((e: { tag: string }) => e.tag < '0018')
  writeFileSync(journalPath, JSON.stringify(journal))
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE')
  await drizzleMigrate(db, { migrationsFolder: upTo17 })
  await pool.query("INSERT INTO users (id, email) VALUES ('m18-c', 'm18-c@test.skilled.invalid'), ('m18-p', 'm18-p@test.skilled.invalid')")
  const p = (await pool.query("INSERT INTO providers (owner_id, status) VALUES ('m18-p', 'published') RETURNING id")).rows[0].id
  const r = (await pool.query("INSERT INTO requests (customer_id, provider_id, description, answer_by) VALUES ('m18-c', $1, 'x', now()) RETURNING id", [p])).rows[0].id
  const paid = (await pool.query("INSERT INTO bookings (customer_id, provider_id, source, status, start_at, duration_min, amount, paid_at) VALUES ('m18-c', $1, 'direct', 'confirmed', now() + interval '9 days', 60, 80, now()) RETURNING id", [p])).rows[0].id
  await migrate()
  expect((await pool.query('SELECT status, parent_booking_id, confirm_reminders_sent, late_cancel, material_amount, finished_at, cancelled_by FROM bookings WHERE id = $1', [paid])).rows).toEqual([
    { status: 'confirmed', parent_booking_id: null, confirm_reminders_sent: 0, late_cancel: false, material_amount: '0.00', finished_at: null, cancelled_by: null },
  ])
  expect((await pool.query('SELECT parent_booking_id FROM requests WHERE id = $1', [r])).rows).toEqual([{ parent_booking_id: null }])
  await pool.query("UPDATE bookings SET status = 'finished', finished_at = now() WHERE id = $1", [paid])
  await pool.query("INSERT INTO notifications (user_id, kind) VALUES ('m18-c', 'job-finished'), ('m18-p', 'provider-warning')")
  await pool.query("INSERT INTO staff_flags (kind, ref_id) VALUES ('dispute-overdue', $1), ('provider-no-shows', $2), ('ignored-requests', $2)", [paid, p])
  await pool.query("INSERT INTO disputes (booking_id, opened_by, reason, description, decide_by) VALUES ($1, 'customer', 'problem', 'x', now())", [paid])
  await pool.query('DELETE FROM disputes; DELETE FROM staff_flags; DELETE FROM notifications; DELETE FROM bookings; DELETE FROM requests; DELETE FROM providers; DELETE FROM users')
}, 60_000)
