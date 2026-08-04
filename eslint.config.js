import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.wxt/**', '.output/**', 'node_modules/**'] },
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
);
