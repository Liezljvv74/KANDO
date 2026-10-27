import type { ProviderDetail, TranslatableTexts } from '@kando/contract'

/** The provider with the translated texts swapped in; names, prices, place, categories and photos stay. Unknown ids are left as they are. */
export function applyTexts(p: ProviderDetail, t: TranslatableTexts): ProviderDetail {
  const services = new Map(t.services.map((s) => [s.id, s]))
  const references = new Map(t.references.map((r) => [r.id, r]))
  return {
    ...p,
    displayName: t.displayName,
    bio: t.bio,
    strengths: t.strengths,
    experience: t.experience,
    skills: t.skills,
    services: p.services.map((s) => {
      const x = services.get(s.id)
      return x ? { ...s, title: x.title, description: x.description } : s
    }),
    references: p.references.map((r) => {
      const x = references.get(r.id)
      return x ? { ...r, description: x.description } : r
    }),
  }
}
