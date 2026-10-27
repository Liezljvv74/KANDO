import type { ProviderDetail, TranslatableTexts } from '@kando/contract'
import { applyTexts } from './translation'

const base: ProviderDetail = {
  slug: 'anna',
  publicName: 'Anna H.',
  bio: 'Hallo',
  strengths: 'Pünktlich',
  skills: ['Fenster'],
  experience: 'Zehn Jahre',
  photoUrl: 'https://x.test/a.jpg',
  place: 'Berlin',
  categories: ['cleaning'],
  services: [
    { id: 's1', category: 'cleaning', title: 'Fenster', description: 'Innen', priceType: 'fixed', price: 20, currency: 'EUR' },
    { id: 's2', category: 'cleaning', title: 'Boden', description: null, priceType: 'hourly', price: 30, currency: 'EUR' },
  ],
  references: [{ id: 'r5', clientName: 'Max', description: 'Gut', year: 2024 }],
  photos: [{ id: 'p9', url: 'https://x.test/p.jpg', alt: null }],
  isNew: false,
  translatable: true,
}
const texts: TranslatableTexts = {
  bio: 'Hello',
  strengths: 'Punctual',
  experience: 'Ten years',
  skills: ['Windows'],
  services: [{ id: 's1', title: 'Windows', description: 'Inside' }],
  references: [{ id: 'r5', description: 'Good' }],
}

test('applyTexts swaps only the translatable fields and keeps names, prices and photos', () => {
  const r = applyTexts(base, texts)
  expect(r).toMatchObject({ bio: 'Hello', strengths: 'Punctual', experience: 'Ten years', skills: ['Windows'] })
  expect(r.publicName).toBe('Anna H.')
  expect(r.place).toBe('Berlin')
  expect(r.categories).toEqual(['cleaning'])
  expect(r.photos).toEqual(base.photos)
  expect(r.services[0]).toMatchObject({ title: 'Windows', description: 'Inside', price: 20, priceType: 'fixed', category: 'cleaning' })
  expect(r.references[0]).toMatchObject({ description: 'Good', clientName: 'Max', year: 2024 })
})

test('applyTexts matches services and references by id and leaves unknown ones untouched', () => {
  const r = applyTexts(base, { ...texts, services: [{ id: 's99', title: 'X', description: null }, ...texts.services], references: [{ id: 'r77', description: 'Y' }] })
  expect(r.services[0].title).toBe('Windows')
  expect(r.services[1]).toEqual(base.services[1])
  expect(r.references).toEqual(base.references)
})

test('applyTexts keeps line breaks', () => {
  const r = applyTexts(base, { ...texts, bio: 'a\nb', strengths: 'x\ny' })
  expect(r.bio).toBe('a\nb')
  expect(r.strengths).toBe('x\ny')
})
