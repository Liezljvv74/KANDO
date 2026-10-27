import { useState } from 'react'
import { Alert, Image, StyleSheet, View } from 'react-native'

import type { Photo as OwnPhoto } from '@kando/contract'

import { photoSrc } from '@/api/providers'
import { photosApi } from '@/api/my-profile'
import { ErrorText, Info } from '@/components/auth-ui'
import { Card, IconButton, SectionHeader } from '@/components/form-ui'
import { errorText, t } from '@/i18n'
import { pickPhoto, uploadErrorCode } from '@/lib/pick'
import { DeniedNotice } from './denied-notice'

export const MAX_PORTFOLIO_PHOTOS = 12 // mirrors MAX_PORTFOLIO_PHOTOS on the server

export function PortfolioCard({ photos, name, onChanged }: { photos: OwnPhoto[]; name: string; onChanged: () => void }) {
  const [busy, setBusy] = useState<'camera' | 'library' | 'remove' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)

  // `action` returns true only when it really changed something (not on cancel or refused permission).
  async function run(source: 'camera' | 'library' | 'remove', action: () => Promise<boolean>) {
    setBusy(source)
    setProblem(null)
    setDenied(false)
    try {
      if (await action()) onChanged()
    } catch (e) {
      setProblem(errorText(uploadErrorCode(e)))
    }
    setBusy(null)
  }

  const add = (source: 'camera' | 'library') =>
    run(source, async () => {
      const file = await pickPhoto(source, false)
      if (file === 'denied') setDenied(true)
      if (typeof file !== 'object' || !file) return false
      await photosApi.add(file, 'portfolio')
      return true
    })

  const choose = () =>
    Alert.alert(t('provider.portfolio'), undefined, [
      { text: t('myProfile.photoTake'), onPress: () => add('camera') },
      { text: t('myProfile.photoChoose'), onPress: () => add('library') },
      { text: t('common.cancel'), style: 'cancel' },
    ])

  const remove = (id: string) =>
    Alert.alert(t('myProfile.portfolioRemoveAsk'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('myProfile.portfolioRemove'), style: 'destructive', onPress: () => run('remove', async () => (await photosApi.remove(id), true)) },
    ])

  return (
    <Card>
      <SectionHeader title={`${t('provider.portfolio')}  ${t('myProfile.portfolioCount', { n: photos.length, max: MAX_PORTFOLIO_PHOTOS })}`}>
        {photos.length < MAX_PORTFOLIO_PHOTOS && (
          <IconButton icon="add-circle-outline" label={t('myProfile.portfolioAdd')} onPress={choose} busy={busy === 'camera' || busy === 'library'} disabled={busy !== null} />
        )}
      </SectionHeader>
      <View style={styles.grid}>
        {photos.map((p, i) => (
          <View key={p.id} style={styles.cell}>
            <Image source={{ uri: photoSrc(p.url) ?? undefined }} accessibilityLabel={p.alt ?? name} style={styles.thumb} />
            <View style={styles.remove}>
              <IconButton icon="close-circle" label={`${t('myProfile.portfolioRemove')} ${i + 1}`} onPress={() => remove(p.id)} disabled={busy !== null} />
            </View>
          </View>
        ))}
      </View>
      <ErrorText text={problem} />
      {denied && <DeniedNotice />}
      {photos.length >= MAX_PORTFOLIO_PHOTOS && <Info text={t('myProfile.portfolioMax', { max: MAX_PORTFOLIO_PHOTOS })} />}
    </Card>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: 72 },
  thumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: '#BFE3D8' },
  // The remove icon sits on the photo's top-right corner.
  remove: { position: 'absolute', top: -12, right: -12 },
})
