import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

import type { MyProfile } from '@kando/contract'

import { Info } from '@/components/auth-ui'
import { Card, DONE_TEXT, EditButton, SectionHeader } from '@/components/form-ui'
import { t } from '@/i18n'
import { aboutComplete } from '@/lib/completeness'
import { aboutSummary } from '@/lib/profile-form'

/** About you: a short summary; the form is on its own screen. */
export function AboutCard({ profile }: { profile: MyProfile }) {
  const router = useRouter()
  const sum = aboutSummary(profile)
  const done = aboutComplete(profile.missing)
  const green = done && { color: DONE_TEXT }
  return (
    <Card done={done}>
      <SectionHeader title={t('setup.aboutYou')} done={done}>
        <EditButton label={`${t('common.edit')}: ${t('setup.aboutYou')}`} onPress={() => router.push('/my-profile/about')} />
      </SectionHeader>
      {sum ? (
        <View>
          {sum.type && <Text style={[styles.name, green]}>{t(sum.type === 'business' ? 'f.business' : 'f.individual')}</Text>}
          {sum.strengths > 0 && <Text style={[styles.status, green]}>{t('setup.aboutStrengths', { n: sum.strengths })}</Text>}
          {sum.bio ? <Text style={[styles.status, green]}>{sum.bio}</Text> : null}
        </View>
      ) : (
        <Info text={t('setup.aboutEmpty')} />
      )}
    </Card>
  )
}

const styles = StyleSheet.create({
  name: { fontSize: 17, fontWeight: '700', color: '#14352E' },
  status: { fontSize: 14, color: '#5C7A72' },
})
