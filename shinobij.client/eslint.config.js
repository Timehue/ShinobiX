import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      // react-refresh/only-export-components is HMR-only ergonomics (it never
      // affects production behaviour). Kept as 'warn' globally so genuine
      // violations in normal modules stay visible; scoped OFF below for the two
      // files that export non-components by design.
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    // App.tsx is the legacy single-file game monolith in active drain: it must
    // re-export many helpers/constants so the modules drained out of it can
    // import them back (the documented drain pattern in CLAUDE.md). That trips
    // the components-only rule ~70× with no real problem. petvfx.tsx is a
    // standalone dev-only VFX harness page (petvfx.html), not in the player
    // bundle. Turn the HMR rule off for just these two; remove the App.tsx entry
    // once the drain is finished.
    files: ['src/App.tsx', 'src/petvfx.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
