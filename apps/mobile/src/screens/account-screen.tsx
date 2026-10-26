import { openBrowserAsync } from 'expo-web-browser'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { API_URL } from '@/api/client'
import { Button } from '@/components/auth-ui'
import { LanguageSwitch } from '@/components/language-switch'
import { useSession } from '@/hooks/use-session'
import { t, useLang } from '@/i18n'

export default function AccountScreen() {
  useLang()
  const { user, signOut } = useSession()
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>{t('tab.account')}</Text>
        {user && (
          <View style={styles.who}>
            <Text style={styles.name}>{user.name}</Text>
            <Text style={styles.email}>{user.email}</Text>
          </View>
        )}
        <LanguageSwitch />
      </View>
      <Button label={t('auth.logOut')} onPress={signOut} />
      {/* Staff shortcut while testing; release builds never show it. The in-app browser's ✕ returns here (createTask false:
          on Android a separate browser task closed to the home screen, not back to the app). */}
      {__DEV__ && (
        <Text style={styles.link} accessibilityRole="link" onPress={() => openBrowserAsync(`${API_URL}/admin`, { createTask: false })}>
          {t('account.admin')}
        </Text>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2FBF8', padding: 16, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: '#0E8A6B' },
  who: { gap: 2 },
  name: { fontSize: 18, fontWeight: '700', color: '#14352E' },
  email: { fontSize: 16, color: '#14352E' },
  link: { marginTop: 'auto', paddingVertical: 12, textAlign: 'center', fontSize: 15, color: '#0E8A6B', textDecorationLine: 'underline' },
})
