import { Redirect } from 'expo-router'

/** The old messages list: old links open the Jobs tab (each chat opens from its job page; `threads/<id>` still opens the chat). */
export default function OldThreadsList() {
  return <Redirect href="/jobs" />
}
