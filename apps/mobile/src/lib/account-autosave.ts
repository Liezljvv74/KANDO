import { toIsoDay } from './birth-date'

/** Postcode shape without a country: 3 to 10 letters, digits, space or dash (the server checks the rest). */
const POSTCODE = /^[A-Za-z0-9][A-Za-z0-9 -]{1,8}[A-Za-z0-9]$/

/** Whether the account details are valid enough to be saved quietly when the person leaves: names filled, an address either empty or with a proper postcode, a birth date in the past. */
export function shouldAutosave(v: { firstName: string; lastName: string; address: { street: string; postcode: string; city: string }; birthDate: Date | null }): boolean {
  if (!v.firstName.trim() || !v.lastName.trim()) return false
  const { street, postcode, city } = v.address
  const pc = postcode.trim()
  if (pc ? !POSTCODE.test(pc) : !!(street.trim() || city.trim())) return false
  return !v.birthDate || toIsoDay(v.birthDate) < toIsoDay(new Date())
}
