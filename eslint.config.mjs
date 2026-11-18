import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out', '**/release'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    files: ['**/*.{ts,tsx,mjs}'],
    rules: {
      // Code copied from OpenSpec Studio (Fase 1) follows its own conventions:
      // no per-function return annotations and deliberate `any` for the shapes
      // of external CLI/JSON output. Enforcing them would rewrite hundreds of
      // working signatures, so both style rules stay off.
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // `_name` and destructuring-rest siblings (`const { a, ...rest } = x`) are
      // intentional "documented but unused" patterns in the copied code.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }
      ],
      // Renderer modules export helpers next to components (e.g. ColumnResizer's
      // clamp helpers): react-refresh then falls back to a full reload, which is
      // fine; the rule would force reshuffling working modules.
      'react-refresh/only-export-components': 'off'
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      // The React-Compiler-derived rules of react-hooks v7 flag long-standing
      // patterns of the copied UI on purpose (Date.now() in a ticking Elapsed
      // component, ref reads to position the comment composer). Reworking them
      // is out of scope for the Fase 1 code import; rules-of-hooks and
      // exhaustive-deps stay active.
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/globals': 'off'
    }
  },
  eslintConfigPrettier
)
