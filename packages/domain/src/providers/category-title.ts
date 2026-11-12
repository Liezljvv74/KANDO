import { eq, inArray } from 'drizzle-orm'
import { categoryTexts, users, type Tx } from '@kando/db'
import { DEFAULT_LANG } from '@kando/i18n'

/** The categories' names in the user's language (default language when missing): the title of a service saved without one. */
export async function categoryTitles(tx: Tx, userId: string, categoryIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!categoryIds.length) return out
  const lang = (await tx.select({ l: users.language }).from(users).where(eq(users.id, userId)))[0]?.l ?? DEFAULT_LANG
  const names = await tx.select({ id: categoryTexts.categoryId, lang: categoryTexts.lang, name: categoryTexts.name }).from(categoryTexts).where(inArray(categoryTexts.categoryId, categoryIds))
  for (const id of categoryIds) {
    const mine = names.filter((n) => n.id === id)
    out.set(id, (mine.find((n) => n.lang === lang) ?? mine.find((n) => n.lang === DEFAULT_LANG))?.name ?? '')
  }
  return out
}

export const categoryTitle = async (tx: Tx, userId: string, categoryId: string): Promise<string> => (await categoryTitles(tx, userId, [categoryId])).get(categoryId) ?? ''
