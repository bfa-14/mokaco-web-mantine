import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * `npm run lint` (QA3 WEB-19). Modest on purpose: the JavaScript and typescript-eslint recommended
 * sets, and the Rules of Hooks as errors. The React Compiler checks that eslint-plugin-react-hooks 7
 * adds to its recommended set (set-state-in-effect, preserve-manual-memoization, static-components,
 * ...) report patterns this codebase uses deliberately and safely today, so they are warnings: seen,
 * not failing the script.
 */
const compilerChecksAsWarnings = Object.fromEntries(
  Object.entries(reactHooks.configs.flat.recommended.rules).map(([rule, level]) => [
    rule,
    rule === 'react-hooks/rules-of-hooks' ? level : 'warn',
  ]),
)

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: compilerChecksAsWarnings,
  },
  {
    // The static scripts served as they are (the sign-in gate).
    files: ['public/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
    },
  },
)
