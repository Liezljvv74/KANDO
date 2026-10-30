'use client'
import type { ReactNode } from 'react'

/** Asks for the translation when clicked (the one paid call), then loads the page with it; without JavaScript it is a plain link that shows what is stored. */
export function TranslateLink({ href, apiPath, children }: { href: string; apiPath: string; children: ReactNode }) {
  return (
    <a
      href={href}
      rel="nofollow"
      onClick={async (e) => {
        e.preventDefault()
        await fetch(apiPath).catch(() => null)
        window.location.assign(href)
      }}
    >
      {children}
    </a>
  )
}
