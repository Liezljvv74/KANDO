/** SecureStore key of "the person dismissed the picture nudge"; one per user, the device may serve several accounts. */
export const pictureNudgeKey = (userId: string) => `skilled.pictureNudgeDismissed.${userId}`
