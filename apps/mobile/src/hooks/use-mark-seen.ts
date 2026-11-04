import { useFocusEffect } from 'expo-router'
import { useCallback } from 'react'

import { loadMe, markNotificationsSeen } from '@/hooks/use-me'
import { categoryOf, type Category } from '@/lib/correspondence'

/** Opening a Correspondence list marks that list's notices seen, so the number on the tab counts only what the person has not looked at yet. */
export function useMarkSeen(category: Category) {
  useFocusEffect(
    useCallback(() => {
      loadMe()
        .then(() => markNotificationsSeen((n) => categoryOf(n) === category))
        .catch(() => {})
    }, [category]),
  )
}
