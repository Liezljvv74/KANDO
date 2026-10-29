export const NEAR_BOTTOM_PX = 80

/** True when the list is scrolled to its end (within a little slack): only then does a new message pull the view down. */
export const nearBottom = ({ contentHeight, viewHeight, offsetY }: { contentHeight: number; viewHeight: number; offsetY: number }) =>
  contentHeight - viewHeight - offsetY <= NEAR_BOTTOM_PX
