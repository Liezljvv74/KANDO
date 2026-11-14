// Route tests live outside src/app: Expo Router treats every file in src/app as a screen.
import * as layout from '@/app/(auth)/_layout'

jest.mock('expo-router', () => ({ Stack: () => null }))

test('the auth group has no start screen of its own: Home is the landing page, back from login or sign-up returns to where the person came from', () => {
  expect((layout as { unstable_settings?: unknown }).unstable_settings).toBeUndefined()
})

test('no test files inside src/app (each file there becomes a screen)', () => {
  // Node APIs exist under Jest; the app's types don't include them.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require('fs')
  const path = require('path')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: { name: string; isDirectory(): boolean }) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [e.name],
    )
  expect(walk(path.join(process.cwd(), 'src', 'app')).filter((f) => /\.test\./.test(f))).toEqual([])
})
