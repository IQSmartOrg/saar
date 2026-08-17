import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * scripts/set-version.mjs, run the way the release workflow runs it.
 *
 * Worth an integration test rather than unit-testing its regexes: it edits real
 * files by pattern, and the failure mode is a release that stops halfway with a
 * confusing message. It shipped once already failing on the most ordinary case
 * there is — releasing the version the repo already carried.
 */

const SCRIPT = resolve('scripts/set-version.mjs');

let dir: string;

const PACKAGE_JSON = `{
  "name": "saar",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "wxt"
  }
}
`;

const LOCK_JSON = `${JSON.stringify(
  {
    name: 'saar',
    version: '0.1.0',
    lockfileVersion: 3,
    packages: {
      '': { name: 'saar', version: '0.1.0' },
      // A dependency that happens to carry the same version string; it must not
      // be rewritten.
      'node_modules/some-dep': { version: '0.1.0' },
    },
  },
  null,
  2,
)}\n`;

const WXT_CONFIG = `import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Saar',
    version: '0.1.0',
    permissions: ['tabs'],
  },
});
`;

function run(version: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, version], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { ok: true, output };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const read = (name: string): string => readFileSync(join(dir, name), 'utf8');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'saar-setversion-'));
  writeFileSync(join(dir, 'package.json'), PACKAGE_JSON);
  writeFileSync(join(dir, 'package-lock.json'), LOCK_JSON);
  writeFileSync(join(dir, 'wxt.config.ts'), WXT_CONFIG);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('setting a new version', () => {
  it('writes it to all three files', () => {
    expect(run('0.2.0').ok).toBe(true);

    expect(read('package.json')).toContain('"version": "0.2.0"');
    expect(read('wxt.config.ts')).toContain("version: '0.2.0'");

    const lock = JSON.parse(read('package-lock.json'));
    expect(lock.version).toBe('0.2.0');
    expect(lock.packages[''].version).toBe('0.2.0');
  });

  it('leaves dependency versions alone', () => {
    run('0.2.0');
    const lock = JSON.parse(read('package-lock.json'));
    expect(lock.packages['node_modules/some-dep'].version).toBe('0.1.0');
  });

  it('touches nothing but the version line', () => {
    run('0.2.0');
    // The one-line `engines` block is the canary: a JSON round-trip expands it,
    // which is diff noise on a release commit.
    expect(read('package.json')).toContain('"engines": { "node": ">=22" }');
    expect(read('wxt.config.ts')).toContain("permissions: ['tabs']");
  });
});

describe('setting the version the files already hold', () => {
  it('succeeds — the committed version is not kept in step with releases', () => {
    // This is the first release's case, and it failed in CI: the script inferred
    // "pattern not found" from "text did not change".
    const result = run('0.1.0');
    expect(result.ok).toBe(true);
    expect(read('package.json')).toContain('"version": "0.1.0"');
  });

  it('leaves the files byte-identical', () => {
    const before = read('package.json');
    run('0.1.0');
    expect(read('package.json')).toBe(before);
  });
});

describe('refusing bad input', () => {
  it.each([
    ['v0.2.0', 'a leading v'],
    ['0.2', 'only two parts'],
    ['1.0.0-beta', 'a prerelease suffix Chrome will not load'],
    ['', 'nothing at all'],
  ])('rejects %j — %s', (version) => {
    expect(run(version).ok).toBe(false);
  });

  it('changes nothing when it refuses', () => {
    const before = read('package.json');
    run('1.0.0-beta');
    expect(read('package.json')).toBe(before);
  });

  it('fails loudly when a version line is genuinely missing', () => {
    writeFileSync(join(dir, 'wxt.config.ts'), 'export default {};\n');
    const result = run('0.2.0');
    expect(result.ok).toBe(false);
    expect(result.output).toContain('wxt.config.ts');
  });
});

describe('running from the wrong directory', () => {
  it('fails rather than silently doing nothing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'saar-empty-'));
    mkdirSync(join(empty, 'sub'), { recursive: true });
    try {
      expect(() =>
        execFileSync('node', [SCRIPT, '0.2.0'], { cwd: empty, stdio: 'pipe' }),
      ).toThrow();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
