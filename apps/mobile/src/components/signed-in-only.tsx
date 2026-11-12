import { router } from 'expo-router'
import type { ComponentType } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/auth-ui'
import { LegalFooter } from '@/components/legal-footer'
import { ScreenBanner } from '@/components/screen-banner'
import { useSession } from '@/hooks/use-session'
import { t, useLang, type Key } from '@/i18n'
import { color } from '@/theme'

/** What a signed-out person sees on a private screen: one line and a button to the login and sign-up page. */
function LoginPrompt({ title, legal }: { title: Key; legal?: boolean }) {
  useLang()
  return (
    <SafeAreaView style={styles.root} edges={['left', 'right', 'bottom']}>
      <ScreenBanner title={t(title)} />
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.text}>{t('auth.needLogin')}</Text>
          <Button label={t('auth.needLoginButton')} onPress={() => router.push('/login')} />
        </View>
        {legal && <LegalFooter />}
      </View>
    </SafeAreaView>
  )
}

/** A private screen (jobs, My business, account, bookings, invoices, chats): the screen when signed in, the login prompt when not. */
export function signedInOnly<P extends object>(Screen: ComponentType<P>, title: Key, legal = false): ComponentType<P> {
  return function SignedInOnly(props: P) {
    const { user } = useSession()
    return user ? <Screen {...props} /> : <LoginPrompt title={title} legal={legal} />
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { padding: 12, gap: 8 },
  card: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.divider, borderRadius: 6, padding: 12, gap: 12 },
  text: { fontSize: 16, color: color.ink, textAlign: 'center' },
})
