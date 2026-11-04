/** Where to go once the person is signed in: "I need help" tapped while signed out leads to the search page after login or sign-up. */
let target: '/search' | null = null

export const setAfterLogin = (t: '/search' | null) => {
  target = t
}
/** The target once, then cleared. */
export function consumeAfterLogin() {
  const t = target
  target = null
  return t
}
