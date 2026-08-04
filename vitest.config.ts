import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    globals: true,
    // Default to node. Tests needing a DOM opt in per file with
    // `// @vitest-environment happy-dom` on the first line.
    // (Vitest 4 removed `environmentMatchGlobs` — do not try to use it.)
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
