import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import securityPlugin from 'eslint-plugin-security'

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  js.configs.recommended,

  // TypeScript files
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        project: './tsconfig.json',
      },
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        alert: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        FormData: 'readonly',
        File: 'readonly',
        Blob: 'readonly',
        navigator: 'readonly',
        caches: 'readonly',
        getComputedStyle: 'readonly',
        confirm: 'readonly',
        location: 'readonly',
        history: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        indexedDB: 'readonly',
        // React global
        React: 'readonly',
        // Browser globals used by tests and environment
        btoa: 'readonly',
        atob: 'readonly',
        Image: 'readonly',
        NostrNip04Api: 'readonly',
        NostrEvent: 'readonly',
        // Node.js globals for config files
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        Buffer: 'readonly',
        // Test globals
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react:                reactPlugin,
      'react-hooks':        reactHooksPlugin,
      security:             securityPlugin,
    },
    rules: {
      // ── TypeScript ──────────────────────────────────────
      ...tsPlugin.configs['recommended'].rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['off', {
        argsIgnorePattern:  '^_',
        varsIgnorePattern:  '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': ['off', {
        prefer: 'type-imports',
      }],
      '@typescript-eslint/no-empty-object-type': 'warn',
      'no-unused-vars': 'off', // replaced by @typescript-eslint/no-unused-vars above
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-undef': 'off',

      // ── React ───────────────────────────────────────────
      ...reactPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope':   'off',  // Not needed with React 17+
      'react/prop-types':            'off',  // TypeScript handles this
      'react/display-name':          'off',
      ...reactHooksPlugin.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'off',

      // ── Security ────────────────────────────────────────
      ...securityPlugin.configs.recommended.rules,
      'security/detect-object-injection':   'off',  // Too many false positives
      'security/detect-non-literal-regexp': 'off',
      'security/detect-unsafe-regex':       'off',
      'security/detect-possible-timing-attacks': 'off',

      // ── General ─────────────────────────────────────────
      'no-console':    'off',
      'no-debugger':    'error',
      'no-eval':        'error',
      'no-implied-eval':'error',
      'no-new-func':    'error',
      'prefer-const':   'error',
      'eqeqeq':        ['error', 'always'],
    },
    settings: {
      react: { version: 'detect' },
    },
  },

  // Ignore build output and generated files
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '*.config.js',
      '*.config.ts',
      'src/sw.ts',       // Service worker has different globals
      'src/workers/**',  // Workers have different globals
    ],
  },
]
