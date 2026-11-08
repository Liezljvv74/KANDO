import { Redirect } from 'expo-router'

/** The old quotes list: old links open the Jobs tab (each quote lives on its job page). */
export default function OldQuotesList() {
  return <Redirect href="/jobs" />
}
