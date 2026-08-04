import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.wxt/**', '.output/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
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
