export type PhotoMenuItem = 'take' | 'choose' | 'remove' | 'cancel'

/** The buttons of the picture menu. Android's Alert shows at most three, so with a picture it has no Cancel (tapping outside dismisses). */
export const photoMenu = (os: 'ios' | 'android', hasPhoto: boolean): PhotoMenuItem[] => {
  const items: PhotoMenuItem[] = hasPhoto ? ['take', 'choose', 'remove'] : ['take', 'choose']
  return os === 'android' && hasPhoto ? items : [...items, 'cancel']
}
