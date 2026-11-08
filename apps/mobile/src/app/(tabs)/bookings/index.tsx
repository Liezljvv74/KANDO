import { Redirect } from 'expo-router'

/** The old "My requests and bookings" list: old links (`skilled://bookings`, the payment-done page, notices) open the Jobs tab. */
export default function OldBookingsList() {
  return <Redirect href="/jobs" />
}
