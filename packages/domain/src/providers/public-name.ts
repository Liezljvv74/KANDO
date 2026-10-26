/**
 * The name other users see: businesses by business name, individuals as first name + surname initial
 * ("Anna-Lena von der Heide" becomes "Anna-Lena H."), so the full surname is never public.
 */
export function publicNameFor(
  profile: { providerType: 'individual' | 'business'; businessName: string | null },
  accountName: string,
): string {
  const business = profile.providerType === 'business' ? (profile.businessName ?? '').trim() : ''
  if (business) return business
  const words = accountName.trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return words[0] ?? ''
  return `${words[0]} ${Array.from(words.at(-1)!)[0]}.`
}
