'use client'
import type { ReactNode } from 'react'
import { useParams } from 'next/navigation'

/** Shows the child for the path's language segment (the layout has already checked it). */
export function InLang({ byLang }: { byLang: Record<string, ReactNode> }) {
  return byLang[useParams<{ lang: string }>().lang]
}
