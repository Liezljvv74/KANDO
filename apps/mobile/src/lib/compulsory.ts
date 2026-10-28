import type { Missing } from '@kando/contract'
import { t, type Key } from '@/i18n'

/**
 * The fields the server's `missing` list asks for (domain `completeness`), each with its label and the short lead text
 * shown inside it. `item` is what the server reports; one item can be several fields (a service: category, price type, price).
 * `name` is not here: it lives on the account screen.
 */
export const COMPULSORY = {
  category: { item: 'service', label: 'search.category', placeholder: 'ph.category' },
  priceType: { item: 'service', label: 's.priceType', placeholder: 'ph.priceType' },
  price: { item: 'service', label: 's.price', placeholder: 'ph.price' },
  providerType: { item: 'providerType', label: 'f.type', placeholder: 'ph.providerType' },
  businessName: { item: 'businessName', label: 'f.businessName', placeholder: 'ph.businessName' },
  impressum: { item: 'impressum', label: 'provider.impressum', placeholder: 'ph.impressum' },
  skills: { item: 'skills', label: 'provider.skills', placeholder: 'ph.skills' },
  experience: { item: 'experience', label: 'provider.experience', placeholder: 'ph.experience' },
  postcode: { item: 'postcode', label: 'search.postcode', placeholder: 'ph.postcode' },
  radius: { item: 'radius', label: 'f.radius', placeholder: 'ph.radius' },
} as const satisfies Record<string, { item: Missing; label: Key; placeholder: Key }>

/** The `label` and `placeholder` props of a compulsory field: its name with a star, and its lead text. */
export const compulsory = (field: keyof typeof COMPULSORY) => ({
  label: `${t(COMPULSORY[field].label)} *`,
  placeholder: t(COMPULSORY[field].placeholder),
})
