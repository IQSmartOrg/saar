#!/usr/bin/env node
/**
 * Sets the release version everywhere it is written down.
 *
 * Three files have to agree and none of them derives from the others:
 *
 *   wxt.config.ts     the manifest version — what Chrome shows, and what
 *                     decides whether an installed copy sees an update
 *   package.json      what `wxt zip` names the release file after
 *   package-lock.json npm rewrites this on the next install if it disagrees,
 *                     which turns into a spurious diff on someone's branch
 *
 * Run by the release workflow before it builds, so the tag, the manifest and
 * the zip filename cannot drift apart. Safe to run by hand:
 *
 *   node scripts/set-version.mjs 0.2.0
 *
 * What is committed on main is deliberately left behind: the workflow writes
 * these files on the release branch it cuts and never reads them back, so the
 * git tags — not any file — record what has shipped. The workflow refuses a
 * version that is not higher than the newest tag, which is what makes that
 * safe.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Deliberately stricter than semver: a Chrome manifest version is one to four
 * dot-separated integers and nothing else, so `0.2.0-beta.1` is a valid npm
 * version that produces an extension Chrome refuses to load.
 */
const VERSION_RE = /^\d+\.\d+\.\d+$/;

const version = process.argv[2];

if (version === undefined || !VERSION_RE.test(version)) {
  console.error('usage: node scripts/set-version.mjs <major.minor.patch>');
  console.error(`refusing "${version ?? ''}" — Chrome manifests take digits and dots only.`);
  process.exit(1);
}

/**
 * Replaces one line and leaves the rest of the file byte-identical.
 *
 * A JSON round-trip would be shorter but reformats whatever it touches — it
 * expanded package.json's one-line `engines` block — and a release is the worst
 * possible moment to introduce unrelated diff noise.
 */
function replaceOnce(path, pattern, replacement) {
  const before = readFileSync(path, 'utf8');
  const after = before.replace(pattern, replacement);
  if (after === before) {
    console.error(`could not find the version line in ${path} (looked for ${pattern}).`);
    process.exit(1);
  }
  writeFileSync(path, after);
}

// Anchored to the start of a line at the file's top level, so it cannot match a
// dependency that happens to carry the same version string.
replaceOnce('package.json', /^(  "version": )"[^"]*"(,)$/m, `$1"${version}"$2`);

// wxt.config.ts: anchored to the manifest block's own indentation, so it cannot
// match a version mentioned in a comment or some future nested option.
replaceOnce('wxt.config.ts', /^(\s*version: )'[^']*'(,)$/m, `$1'${version}'$2`);

/**
 * The lock file carries the root version twice — once at the top and once under
 * `packages` with the empty-string key. Missing the second is what leaves
 * `npm ci` rewriting the file.
 *
 * Parsed rather than regexed here because dependency entries carry thousands of
 * `"version"` lines that must not be touched. Verified lossless: npm writes this
 * file with the same two-space indent and trailing newline JSON.stringify does.
 */
const LOCK_PATH = 'package-lock.json';
const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
lock.version = version;
if (lock.packages?.['']) lock.packages[''].version = version;
writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`);

console.log(`version set to ${version} in package.json, ${LOCK_PATH} and wxt.config.ts`);
