/** The My profile tab is for providers; unknown (still loading, signed out) counts as not a provider. */
export const showProfileTab = (me: { isProvider: boolean } | null) => me?.isProvider === true
