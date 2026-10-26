import { eq } from 'drizzle-orm'
import { addReference, addService, publish, upsertMyProfile } from '@kando/domain'
import type { ProfileInput, ReferenceInput } from '@kando/contract'
import { asUser } from '../as-user'
import { db } from '../client'
import { categories, providers, users } from '../schema'
import { givePlaceholderPhoto, isDevBranch } from './placeholder-photos'

export const TEST_PASSWORD = 'TestPass123'

type Service = { category: string; title: string; description: string; priceType: 'fixed' | 'hourly' | 'from' | 'on-request'; price?: number }
type Account = { email: string; name: string; language?: 'de' | 'en' }
type Provider = Account & { profile: ProfileInput; services: Service[]; references?: ReferenceInput[] }

const customers: Account[] = [
  { email: 'kunde.berlin@example.com', name: 'Anna Schulz' },
  { email: 'kunde.muenchen@example.com', name: 'Markus Huber' },
  { email: 'kunde.koeln@example.com', name: 'Sabine Becker' },
  { email: 'customer.hamburg@example.com', name: 'James Miller', language: 'en' },
  { email: 'kunde.dresden@example.com', name: 'Katrin Vogel' },
]

const providerList: Provider[] = [
  {
    email: 'anbieter.foto.berlin@example.com', name: 'Lena Fischer',
    profile: { displayName: 'Hochzeits- und Eventfotografie in Berlin', providerType: 'individual', basePostcode: '10115', serviceRadiusKm: 50,
      bio: 'Ich begleite Hochzeiten, Firmenfeiern und Familienfeste mit der Kamera – natürlich und unaufdringlich.',
      strengths: 'Ruhige Art, schnelle Lieferung der Bilder (innerhalb von 7 Tagen).', skills: ['Hochzeiten', 'Portraits', 'Bildbearbeitung'], experience: 'Seit 2015 selbstständige Fotografin' },
    services: [
      { category: 'photography', title: 'Hochzeitsreportage (8 Stunden)', description: 'Vom Getting Ready bis zum ersten Tanz, ca. 400 bearbeitete Bilder.', priceType: 'fixed', price: 1490 },
      { category: 'photography', title: 'Portrait-Shooting', description: '1 Stunde draußen oder im Studio, 15 bearbeitete Bilder.', priceType: 'from', price: 129 },
    ],
    references: [{ clientName: 'Familie Krüger', description: 'Hochzeit im Schloss Ribbeck, 120 Gäste.', year: 2025 }],
  },
  {
    email: 'anbieter.dj.hamburg@example.com', name: 'Tobias Wagner',
    profile: { displayName: 'DJ für Hochzeiten und Firmenfeiern', providerType: 'business', businessName: 'Nordbeat Events GmbH', basePostcode: '20095', serviceRadiusKm: 150,
      bio: 'Professionelle DJ-Teams mit eigener Licht- und Tontechnik für Feiern in ganz Norddeutschland.',
      strengths: 'Eigene Technik, Musikwünsche vorab per Playlist.', skills: ['Hochzeiten', 'Firmenfeiern', 'Lichttechnik'], experience: 'Über 600 Veranstaltungen seit 2012',
      impressum: 'Nordbeat Events GmbH, Beispielstraße 1, 20095 Hamburg, HRB 000000 (Testdaten)' },
    services: [{ category: 'dj', title: 'DJ-Abend inkl. Technik (bis 6 Stunden)', description: 'DJ, Musikanlage und Grundbeleuchtung.', priceType: 'from', price: 890 }],
  },
  {
    email: 'anbieter.umzug.muenchen@example.com', name: 'Stefan Bauer',
    profile: { displayName: 'Umzüge und Entrümpelung in München', providerType: 'business', businessName: 'Isar Umzüge', basePostcode: '80331', serviceRadiusKm: 80,
      bio: 'Kleiner Familienbetrieb für Umzüge, Haushaltsauflösungen und Möbeltransporte.',
      strengths: 'Festpreis nach Besichtigung, versichert.', skills: ['Umzug', 'Entrümpelung', 'Möbelmontage'], experience: 'Familienbetrieb seit 2008',
      impressum: 'Isar Umzüge, Inhaber Stefan Bauer, Beispielweg 2, 80331 München (Testdaten)' },
    services: [
      { category: 'moving-clearance', title: 'Umzug mit 2 Helfern und Transporter', description: 'Pro Stunde, Anfahrt im Stadtgebiet inklusive.', priceType: 'hourly', price: 95 },
      { category: 'assembly', title: 'Küchen- und Möbelmontage', description: 'Auf- und Abbau von Möbeln und Küchen.', priceType: 'hourly', price: 45 },
    ],
    references: [{ clientName: 'Herr M. aus Schwabing', description: '3-Zimmer-Wohnung, Umzug innerhalb Münchens an einem Tag.', year: 2026 }],
  },
  {
    email: 'anbieter.reinigung.koeln@example.com', name: 'Ayse Yilmaz',
    profile: { displayName: 'Wohnungs- und Büroreinigung in Köln', providerType: 'individual', basePostcode: '50667', serviceRadiusKm: 20,
      bio: 'Gründliche Reinigung für Wohnungen, Büros und Endreinigung nach dem Auszug.',
      strengths: 'Zuverlässig, eigene Reinigungsmittel.', skills: ['Grundreinigung', 'Endreinigung', 'Fensterputzen'], experience: '10 Jahre Erfahrung in der Gebäudereinigung' },
    services: [
      { category: 'cleaning', title: 'Wohnungsreinigung', description: 'Regelmäßig oder einmalig.', priceType: 'hourly', price: 28 },
      { category: 'cleaning', title: 'Endreinigung nach Auszug', description: 'Preis nach Größe der Wohnung.', priceType: 'on-request' },
    ],
  },
  {
    email: 'anbieter.web.frankfurt@example.com', name: 'Daniel Koch', language: 'en',
    profile: { displayName: 'Websites and online marketing for small businesses', providerType: 'individual', basePostcode: '60311', serviceRadiusKm: 30, worksRemotely: true,
      bio: 'I build fast, simple websites and help small businesses get found on Google.',
      strengths: 'Fixed prices, German and English.', skills: ['Web design', 'SEO', 'Google Ads'], experience: 'Freelancer since 2018' },
    services: [
      { category: 'digital-services', title: 'Business website (up to 5 pages)', description: 'Design, texts on request, hosting set-up.', priceType: 'from', price: 1200 },
      { category: 'marketing', title: 'SEO check', description: 'Report with the 10 most important fixes.', priceType: 'fixed', price: 249 },
    ],
  },
  {
    email: 'anbieter.garten.stuttgart@example.com', name: 'Jürgen Maier',
    profile: { displayName: 'Gartenpflege und Kleinreparaturen in Stuttgart', providerType: 'individual', basePostcode: '70173', serviceRadiusKm: 25,
      bio: 'Rasen mähen, Hecken schneiden, kleine Reparaturen im Haus – alles aus einer Hand.',
      strengths: 'Flexibel, auch am Wochenende.', skills: ['Heckenschnitt', 'Rasenpflege', 'Reparaturen'], experience: 'Gelernter Gärtner, seit 2020 selbstständig' },
    services: [
      { category: 'gardening', title: 'Gartenpflege', description: 'Rasen, Hecken, Laub.', priceType: 'hourly', price: 35 },
      { category: 'small-repairs', title: 'Kleinreparaturen im Haushalt', description: 'Tropfender Wasserhahn, klemmende Tür, Lampen anbringen.', priceType: 'hourly', price: 40 },
    ],
  },
  {
    email: 'anbieter.gassi.leipzig@example.com', name: 'Mia Hoffmann',
    profile: { displayName: 'Gassi-Service in Leipzig', providerType: 'individual', basePostcode: '04109', serviceRadiusKm: 10,
      bio: 'Ich gehe mit Ihrem Hund spazieren – einzeln oder in kleinen Gruppen.',
      strengths: 'Hundeerfahren, Erste-Hilfe-Kurs für Hunde.', skills: ['Gassi gehen', 'Hundebetreuung'], experience: 'Seit 3 Jahren Hundesitterin' },
    services: [{ category: 'dog-walking', title: 'Gassi-Runde (60 Minuten)', description: 'Abholung und Rückgabe zu Hause.', priceType: 'fixed', price: 18 }],
  },
  {
    email: 'anbieter.catering.duesseldorf@example.com', name: 'Carla Rossi',
    profile: { displayName: 'Italienisches Catering für Feiern', providerType: 'business', businessName: 'Cucina Carla', basePostcode: '40213', serviceRadiusKm: 60,
      bio: 'Hausgemachte italienische Küche für Feiern von 20 bis 200 Gästen.',
      strengths: 'Vegetarische und vegane Menüs, Geschirr inklusive.', skills: ['Buffet', 'Fingerfood', 'Vegan'], experience: 'Catering seit 2016',
      impressum: 'Cucina Carla, Inhaberin Carla Rossi, Beispielplatz 3, 40213 Düsseldorf (Testdaten)' },
    services: [{ category: 'catering', title: 'Italienisches Buffet', description: 'Pro Person, ab 20 Gästen.', priceType: 'from', price: 32 }],
  },
  {
    email: 'anbieter.beratung.nuernberg@example.com', name: 'Thomas Weber',
    profile: { displayName: 'Unternehmensberatung für Gründer', providerType: 'individual', basePostcode: '90402', serviceRadiusKm: 100, worksRemotely: true,
      bio: 'Businessplan, Finanzplanung und Förderanträge für Gründerinnen und Gründer.',
      strengths: 'Ehemaliger Bankberater, kennt die Förderprogramme.', skills: ['Businessplan', 'Finanzplanung', 'Fördermittel'], experience: '15 Jahre Bank, seit 2019 Berater' },
    services: [{ category: 'management-consulting', title: 'Gründungsberatung', description: 'Online oder vor Ort.', priceType: 'hourly', price: 90 }],
  },
]

/** Creates an auth account (or, when the email exists, signs into it) and returns its id. */
export type TestAuth = { signUp(email: string, password: string, name: string): Promise<{ id: string }> }

/** Refuses anywhere but the development branch, no override. */
export function assertDevBranch(branch: string | undefined): void {
  if (!isDevBranch(branch)) throw new Error(`Test users go on the dev branch only (NEON_BRANCH=kando-dev or dev, got ${branch ?? 'unset'})`)
}

/** Neon Auth over REST. Never logs the password or tokens. */
export function neonAuth(baseUrl: string): TestAuth {
  // A rate-limited or failing call (429, 5xx) is retried a few times, slowly.
  const post = async (path: string, body: object) => {
    for (let attempt = 1; ; attempt++) {
      const res = await send(path, body)
      if ((res.status !== 429 && res.status < 500) || attempt === 4) return res
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
  const send = (path: string, body: object) =>
    fetch(`${baseUrl.replace(/\/$/, '')}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify(body),
    })
  return {
    async signUp(email, password, name) {
      let res = await post('sign-up/email', { email, password, name })
      if (!res.ok) res = await post('sign-in/email', { email, password }) // email taken: the account exists already
      const id = ((await res.json().catch(() => null)) as { user?: { id?: string } } | null)?.user?.id
      if (!res.ok || !id) throw new Error(`Neon Auth sign-up and sign-in failed for ${email} (HTTP ${res.status})`)
      return { id }
    },
  }
}

/** One account: auth, users row, and for a provider the profile, services, references and photo through the domain, published. */
export async function buildTestUser(auth: TestAuth, a: Account | Provider, categoryIds: Map<string, string>): Promise<boolean> {
  const { id } = await auth.signUp(a.email, TEST_PASSWORD, a.name)
  const existing = (await db.select({ id: users.id }).from(users).where(eq(users.id, id)))[0]
  const hasProvider = existing && (await db.select({ id: providers.id }).from(providers).where(eq(providers.ownerId, id))).length > 0
  if (existing && (hasProvider || !('profile' in a))) return false
  if (!existing) await db.insert(users).values({ id, email: a.email, name: a.name, language: a.language ?? 'de' })
  if (!('profile' in a)) return true
  await asUser(id, async (tx) => {
    await upsertMyProfile(tx, id, a.profile)
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
export async function seedTestUsers(auth: TestAuth): Promise<{ created: number; skipped: number }> {
  const categoryIds = new Map((await db.select({ id: categories.id, slug: categories.slug }).from(categories)).map((c) => [c.slug, c.id]))
  const missing = [...new Set(providerList.flatMap((p) => p.services.map((s) => s.category)))].filter((s) => !categoryIds.has(s))
  if (missing.length) throw new Error(`Unknown categories: ${missing.join(', ')}; run pnpm db:seed:categories first`)
  let created = 0
  let skipped = 0
  for (const a of [...customers, ...providerList]) {
    if (await buildTestUser(auth, a, categoryIds)) created++
    else skipped++
  }
  return { created, skipped }
}
