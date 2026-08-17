import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.wxt/**',
      '.output/**',
      'dist/**',
      // Stray build trees WXT can drop at the repo root — linting minified
      // bundles produces hundreds of meaningless errors.
      'chrome-mv3/**',
      'firefox-mv2/**',
      'node_modules/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow `const { a: _a, ...rest } = obj` to strip keys, and _-prefixed
      // args, without tripping no-unused-vars.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['src/adapters/meet/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'chrome',
          message:
            'adapters/meet must stay chrome-free so it ports to Puppeteer. See spec §5.',
        },
      ],
    },
  },
  {
    // The processing pipeline is pure except for the two files that persist and
    // schedule it. Keeping the rest chrome-free is what lets the chunker, the
    // prompts and the map-reduce engine be tested without a browser.
    files: ['src/processing/**/*.ts'],
    ignores: ['src/processing/JobStore.ts', 'src/processing/runner.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'chrome',
          message:
            'Only JobStore.ts and runner.ts may touch chrome.* — the rest of src/processing must stay testable without a browser.',
        },
      ],
    },
  },
  {
    // The one deliberate exception: openTab.ts owns the chrome.tabs plumbing so
    // that every other file in adapters/meet can stay chrome-free. Must come
    // after the block above — in flat config, later entries win.
    files: ['src/adapters/meet/openTab.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
);
