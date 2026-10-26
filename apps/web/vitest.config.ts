import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.int.spec.ts'],
    globalSetup: ['../../packages/db/src/test/setup.ts'],
    fileParallelism: false, // test files share one database
  },
})
