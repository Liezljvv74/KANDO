import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// Neon Auth settings from the root .env (git-ignored); absent in CI without secrets, then the auth test skips.
try {
  for (const line of readFileSync('../../.env', 'utf8').split(/\r?\n/)) {
    const m = /^(NEON_AUTH_[A-Z_]+)=(.*)$/.exec(line)
    const key = m?.[1]
    if (key && !process.env[key]) process.env[key] = m[2]
  }
} catch {
  // no .env
}

export default defineConfig({
  // The auth package imports next/headers without an extension, which plain Node ESM cannot resolve.
  resolve: { alias: { 'next/headers': 'next/headers.js', 'next/server': 'next/server.js' } },
  test: {
    include: ['tests/**/*.int.spec.ts'],
    globalSetup: ['../../packages/db/src/test/setup.ts'],
    server: { deps: { inline: [/@neondatabase/] } },
    fileParallelism: false, // test files share one database
  },
})
