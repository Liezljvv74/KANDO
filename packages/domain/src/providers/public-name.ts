/**
 * The name other users see: businesses by business name, individuals as first name + surname initial
 * ("Anna-Lena", "von der Heide" becomes "Anna-Lena H."), so the full surname is never public. '' without a name.
 */
export function publicNameFor(
  firstName: string | null,
  lastName: string | null,
  businessName: string | null,
  type: string | null,
): string {
  const business = type === 'business' ? (businessName ?? '').trim() : ''
  if (business) return business
  const first = (firstName ?? '').trim()
  const last = (lastName ?? '').trim().split(/\s+/).filter(Boolean).at(-1)
  return last && first ? `${first} ${Array.from(last)[0]}.` : first
}
