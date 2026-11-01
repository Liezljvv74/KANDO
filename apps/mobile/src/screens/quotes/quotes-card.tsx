import { StyleSheet, View } from 'react-native'

import { LinkText } from '@/components/auth-ui'
import { t, useLang } from '@/i18n'
import { go } from '@/lib/go'

/** Account tab: the link to the quote list (received quotes for everyone, sent quotes for a provider, both on that screen). */
export function QuotesCard() {
  useLang()
  return (
    <View style={styles.card}>
      <LinkText label={t('booking.quotes')} onPress={() => go('/quotes')} />
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 12 },
})
