import type { Category } from '@kando/contract'

import { Select } from '@/components/select'
import { t } from '@/i18n'

/** The category dropdown; "All categories" clears the choice. */
export function CategorySelect({ categories, value, onChange }: { categories: Category[]; value: string | null; onChange: (slug: string | null) => void }) {
  return (
    <Select
      label={t('search.category')}
      value={value ?? ''}
      onChange={(slug) => onChange(slug || null)}
      options={[{ value: '', label: t('search.allCategories') }, ...categories.map((c) => ({ value: c.slug, label: c.name }))]}
      hint={t('search.categoryHint')}
      searchable
    />
  )
}
