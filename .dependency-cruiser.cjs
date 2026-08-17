/**
 * The rules that keep the folder structure honest.
 *
 * Two directions matter. Domain modules must not reach outward into the
 * extension (that is what makes them testable and portable), and the Meet
 * automation must not reach into anything Chrome-shaped (that is what lets the
 * cloud build reuse it under Puppeteer).
 */
const DOMAIN = '^src/(meet|capture|session|minutes|processing|storage|settings|messaging|utils)';

module.exports = {
  forbidden: [
    {
      name: 'domain-stays-pure',
      severity: 'error',
      comment: 'domain modules must not depend on entrypoints, agents or the background worker',
      from: { path: DOMAIN },
      to: { path: '^src/(entrypoints|agents|background|ui)' },
    },
    {
      name: 'meet-stays-portable',
      severity: 'error',
      comment: 'src/meet must run unchanged under Puppeteer: no extension-specific modules',
      from: { path: '^src/meet' },
      to: { path: '^src/(bot|storage|settings|messaging|processing)' },
    },
    {
      name: 'utils-depend-on-nothing',
      severity: 'error',
      comment: 'src/utils is leaf code — anything with a dependency belongs in a module',
      from: { path: '^src/utils' },
      to: { path: '^src/(?!utils)' },
    },
    {
      name: 'ui-is-presentation-only',
      severity: 'error',
      comment: 'src/ui renders; it must not reach into storage, the model or the message bus',
      from: { path: '^src/ui' },
      to: { path: '^src/(storage|processing|background|agents|bot)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'nothing imports this file — dead code, or a missing wire-up',
      from: {
        orphan: true,
        pathNot: ['^src/entrypoints/', '\\.d\\.ts$'],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    // Count `import type` edges. Without this the ports — which are nothing but
    // types — look like orphans, and every rule about who may depend on them is
    // silently unenforced.
    tsPreCompilationDeps: true,
  },
};
