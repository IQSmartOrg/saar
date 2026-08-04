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
