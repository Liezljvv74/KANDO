import { useRouter } from 'expo-router'

import type { MyProfile } from '@kando/contract'

import { Card, EditButton, SectionHeader } from '@/components/form-ui'
import { t } from '@/i18n'
import { aboutComplete } from '@/lib/completeness'

/** About you: only the title and the pencil (owner decision, 13 November 2026); the form is on its own screen. */
export function AboutCard({ profile }: { profile: MyProfile }) {
  const router = useRouter()
  const done = aboutComplete(profile.missing)
  return (
    <Card done={done}>
      <SectionHeader title={t('setup.aboutYou')} done={done}>
        <EditButton label={`${t('common.edit')}: ${t('setup.aboutYou')}`} onPress={() => router.push('/my-profile/about')} />
      </SectionHeader>
    </Card>
  )
}
