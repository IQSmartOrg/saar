module.exports = {
  forbidden: [
    {
      name: 'core-stays-pure',
      severity: 'error',
      comment: 'core/** must not depend on adapters or entrypoints (spec §5)',
      from: { path: '^src/core' },
      to: { path: '^src/(adapters|entrypoints)' },
    },
    {
      name: 'processing-stays-portable',
      severity: 'error',
      comment: 'src/processing must not depend on extension entrypoints or Meet adapters',
      from: { path: '^src/processing' },
      to: { path: '^src/(entrypoints|adapters)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
