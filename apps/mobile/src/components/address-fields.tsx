import type { Address } from '@kando/contract'

import { Field } from '@/components/auth-ui'
import { t } from '@/i18n'

export type AddressInput = { street: string; postcode: string; city: string }
export const EMPTY_ADDRESS: AddressInput = { street: '', postcode: '', city: '' }

/** null when empty, an Address when it has a postcode (street and city optional; the account's stored country is kept, Germany until one exists), undefined when street or city has no postcode. */
export function toAddress(a: AddressInput, country = 'DE'): Address | null | undefined {
  const [street, postcode, city] = [a.street.trim(), a.postcode.trim(), a.city.trim()]
  if (!street && !postcode && !city) return null
  return postcode ? { postcode, ...(street && { street }), ...(city && { city }), country } : undefined
}

export function AddressFields({ value, onChange }: { value: AddressInput; onChange: (a: AddressInput) => void }) {
  return (
    <>
      <Field label={t('address.street')} value={value.street} onChangeText={(street) => onChange({ ...value, street })} autoComplete="street-address" />
      <Field label={t('address.postcode')} value={value.postcode} onChangeText={(postcode) => onChange({ ...value, postcode })} keyboardType="number-pad" autoComplete="postal-code" />
      <Field label={t('address.city')} value={value.city} onChangeText={(city) => onChange({ ...value, city })} />
    </>
  )
}
