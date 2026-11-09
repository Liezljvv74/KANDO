import { sql, type SQL } from 'drizzle-orm'

/** The country is not in the countries table (a data error, never a client mistake). */
export class UnknownCountryError extends Error {
  constructor(country: unknown) {
    super(`No currency for country ${String(country)}: it is missing from the countries table`)
    this.name = 'UnknownCountryError'
  }
}

/** A subselect for the currency of a country code (or of a SQL expression giving one); put it inside a query that already runs, so no extra round trip. */
export const currencyOfCountrySql = (country: string | SQL) => sql<string | null>`(SELECT currency FROM countries WHERE code = ${country})`

/** The value a `currencyOfCountrySql` column read back; throws UnknownCountryError when the country was not found. */
export const requireCurrency = (currency: string | null | undefined, country: unknown): string => {
  if (!currency) throw new UnknownCountryError(country)
  return currency
}

/** The currency of a country record (the one place that reads it). */
export async function currencyOfCountry(tx: { execute: (q: SQL) => PromiseLike<{ rows: unknown[] }> }, country: string): Promise<string> {
  const rows = (await tx.execute(sql`SELECT ${currencyOfCountrySql(country)} AS currency`)).rows as { currency: string | null }[]
  return requireCurrency(rows[0]?.currency, country)
}
