import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

import type { MyProfile } from '@kando/contract'

import { Info } from '@/components/auth-ui'
import { Card, EditButton, SectionHeader } from '@/components/form-ui'
import { t } from '@/i18n'
import { aboutSummary } from '@/lib/profile-form'

/** About you: a short summary; the form is on its own screen. */
export function AboutCard({ profile }: { profile: MyProfile }) {
  const router = useRouter()
  const sum = aboutSummary(profile)
  return (
    <Card>
      <SectionHeader title={t('setup.aboutYou')}>
        <EditButton label={`${t('common.edit')}: ${t('setup.aboutYou')}`} onPress={() => router.push('/my-profile/about')} />
      </SectionHeader>
      {sum ? (
        <View>
          {sum.type && <Text style={styles.name}>{t(sum.type === 'business' ? 'f.business' : 'f.individual')}</Text>}
          {sum.strengths > 0 && <Text style={styles.status}>{t('setup.aboutStrengths', { n: sum.strengths })}</Text>}
          {sum.bio ? <Text style={styles.status}>{sum.bio}</Text> : null}
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
