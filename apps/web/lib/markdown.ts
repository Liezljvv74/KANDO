import { Marked } from 'marked'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// Absolute http(s) and mailto links, or paths and anchors on this site; never javascript: or data:.
const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i

// Page bodies are written by staff, but still rendered as plain Markdown: raw HTML is shown as text, unsafe URLs are dropped.
const md = new Marked({
  renderer: {
    html: ({ text }) => esc(text),
    link(token) {
      return SAFE_URL.test(token.href) ? false : this.parser.parseInline(token.tokens)
    },
    image: (token) => (SAFE_URL.test(token.href) ? false : esc(token.text)),
  },
})

export const renderMarkdown = (source: string): string => md.parse(source, { async: false })
