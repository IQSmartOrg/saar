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
    // The Meet automation must run unchanged under Puppeteer for the cloud
    // build, so it may not touch any extension API. `src/agents` is where the
    // chrome-shaped wiring around it lives instead.
    files: ['src/meet/**/*.ts', 'src/utils/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'chrome',
          message: 'src/meet and src/utils must stay chrome-free. Put the wiring in src/agents.',
        },
      ],
    },
  },
  {
    // The processing pipeline is pure except for the two files that persist and
    // schedule it. Keeping the rest chrome-free is what lets the chunker, the
    // prompts and the map-reduce engine be tested without a browser.
    files: ['src/processing/**/*.ts'],
    ignores: ['src/processing/job/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'chrome',
          message:
            'Only src/processing/job may touch chrome.* — the rest of src/processing must stay testable without a browser.',
        },
      ],
    },
  },
);
