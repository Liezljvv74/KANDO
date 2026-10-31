import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/node_modules/', '**/.next/', '**/.expo/', '**/dist/', '**/next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // CommonJS tool configs (Metro, Expo config plugins, the Jest setup).
    files: ['**/metro.config.js', 'apps/mobile/plugins/*.js', 'apps/mobile/jest.setup.js'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', module: 'writable', __dirname: 'readonly', jest: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)
