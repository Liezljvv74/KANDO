/** KANDO colours (the design system file Kando.mhtml). Flat colour only; never teal as text on a light ground. */
export const color = {
  bg: '#E3F6EE',
  surface: '#FFFFFF',
  indigo: '#34328A', // hero, accent text, links, selected
  teal: '#19C3B8', // the one primary action; the label on it is ink
  ink: '#1D1C4A',
  inkMuted: '#4F4E7D',
  border: '#7B7AB8',
  divider: '#CFE6DC',
  danger: '#B3261E',
  success: '#08674F',
  onIndigoMuted: '#B3B2F5',
  placeholder: '#72719D', // placeholder text in inputs: clearly lighter than typed text, still 4.6:1 on white (the accessibility minimum is 4.5:1)
} as const

/** Old-times shop type: a warm serif for headlines, a typewriter face for stamps and tags. */
export const font = {
  display: 'Fraunces_900Black',
  heading: 'Fraunces_700Bold',
  tag: 'CourierPrime_700Bold',
} as const

/** The small fold and dropdown arrows (▾ ▸ ▴), on every page: large enough to see at a glance (owner decision, 13 November 2026). */
export const foldArrow = { fontSize: 30, lineHeight: 30 } as const
