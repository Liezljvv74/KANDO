import { useLocalSearchParams, useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { MAX_MESSAGE_CHARS } from '@kando/contract'

import { blockUser, listBlocks, listThreads, unblockUser } from '@/api/chat'
import { ApiError } from '@/api/client'
import { ErrorText, LinkText } from '@/components/auth-ui'
import { SmallButton } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { useThreadMessages } from '@/hooks/use-thread-messages'
import { errorText, t, useLang } from '@/i18n'
import { askPhotoSource } from '@/lib/ask-photo-source'
import { confirmDanger } from '@/lib/confirm'
import { pickPhoto, uploadErrorCode } from '@/lib/pick'
import { DeniedNotice } from '@/screens/my-profile/denied-notice'
import { MessageBubble } from '@/screens/chat/message-bubble'

const load = async () => {
  const [threads, blocks] = await Promise.all([listThreads(), listBlocks()])
  return { threads, blocks }
}

/** One conversation. Deep link `skilled://threads/<id>` (the new-message notice) lands here. */
export default function ThreadScreen() {
  useLang()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { messages, send, sendPhoto, error } = useThreadMessages(id)
  const { data, error: loadError, retry } = useLoad(load)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const list = useRef<FlatList>(null)

  const thread = data?.threads.find((x) => x.id === id)
  if (!data || !thread)
    return (
      <SafeAreaView style={styles.root}>
        <LinkText label={t('common.back')} onPress={() => router.back()} />
        {loadError || data ? <ErrorRetry code={loadError ?? 'Not found'} onRetry={retry} /> : <Loading />}
      </SafeAreaView>
    )
  const blockedByMe = data.blocks.some((b) => b.userId === thread.otherUserId)

  async function submit() {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      await send(body)
      setText('')
    } catch {
      // The text stays so it can be rewritten; `error` shows the reason under the input.
    }
    setBusy(false)
  }

  async function attach(source: 'camera' | 'library') {
    setBusy(true)
    setDenied(false)
    setProblem(null)
    try {
      const file = await pickPhoto(source, false)
      if (file === 'denied') setDenied(true)
      else if (file) await sendPhoto(file)
    } catch (e) {
      // A refused upload already set `error`; a photo that could not be read or converted has no server answer.
      if (!(e instanceof ApiError)) setProblem(errorText(uploadErrorCode(e)))
    }
    setBusy(false)
  }

  async function toggleBlock() {
    const unblock = blockedByMe
    if (!(await confirmDanger(t(unblock ? 'chat.unblockAsk' : 'chat.blockAsk', { name: thread!.otherName }), t(unblock ? 'chat.unblock' : 'chat.block')))) return
    try {
      await (unblock ? unblockUser(thread!.otherUserId) : blockUser(thread!.otherUserId))
      retry()
    } catch (e) {
      setProblem(errorText(e instanceof ApiError ? e.code : 'network'))
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <LinkText label={t('common.back')} onPress={() => router.back()} />
          <Text style={styles.title} numberOfLines={1}>{thread.otherName}</Text>
          {(!thread.blocked || blockedByMe) && <SmallButton label={t(blockedByMe ? 'chat.unblock' : 'chat.block')} onPress={toggleBlock} />}
        </View>
        <FlatList
          ref={list}
          style={styles.flex}
          contentContainerStyle={styles.messages}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<Text style={styles.empty}>{t('chat.noMessages')}</Text>}
          keyboardShouldPersistTaps="handled"
        />
        {thread.blocked ? (
          <Text style={styles.blocked}>{t('chat.blocked')}</Text>
        ) : (
          <View style={styles.composer}>
            <ErrorText text={error ?? problem} />
            {denied && <DeniedNotice />}
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder={t('chat.placeholder')}
                accessibilityLabel={t('chat.placeholder')}
                placeholderTextColor="#7A948D"
                maxLength={MAX_MESSAGE_CHARS}
                multiline
                editable={!busy}
              />
              <SmallButton label={t('chat.send')} onPress={submit} busy={busy} disabled={!text.trim()} />
            </View>
            <SmallButton label={t('chat.addPhoto')} onPress={() => askPhotoSource(attach)} disabled={busy} />
          </View>
        )}
        {thread.blocked && <ErrorText text={problem} />}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2FBF8', padding: 12 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: '#14352E' },
  messages: { paddingVertical: 8, flexGrow: 1 },
  empty: { textAlign: 'center', color: '#5C7A72', padding: 24 },
  blocked: { textAlign: 'center', color: '#5C7A72', padding: 12, fontSize: 15 },
  composer: { gap: 8, paddingTop: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderColor: '#BFD6CE', borderRadius: 10, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, color: '#14352E' },
})
