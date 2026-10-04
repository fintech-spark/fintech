import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Deployment configuration invariants.
 *
 * These guards prevent regressions of the Vercel production deployment fixes:
 *   1. Node `engines` is bounded to a single major so Vercel never auto-moves
 *      to a future major Node release. An open-ended `>=24.x` is a regression.
 *   2. The only legitimate install-script dependency (`unrs-resolver`, pulled
 *      transitively by `eslint-config-next` → `eslint-import-resolver-typescript`)
 *      is explicitly allow-listed in `.npmrc` so Vercel's stricter install
 *      policy runs it deterministically instead of warning that the script is
 *      "not approved".
 *
 * ESLint is intentionally retained on the 9.x maintenance line: eslint 10
 * breaks `eslint-config-next`'s bundled plugins (eslint-plugin-import,
 * -jsx-a11y, -react), whose peer ranges cap at `^9`. That is a conscious
 * retention, not a config invariant to assert here.
 */

const repoRoot = resolve(new URL('../', import.meta.url).pathname);
const readRepo = (name: string) => readFileSync(resolve(repoRoot, name), 'utf8');

describe('Vercel deployment config', () => {
  it('pins Node to a single major (no open-ended >= future-major drift)', () => {
    const pkg = JSON.parse(readRepo('package.json'));
    const node = pkg?.engines?.node;
    expect(typeof node).toBe('string');
    // Bounded above: prevents Vercel auto-upgrading to a future Node major.
    expect(node).toMatch(/<\s*\d+/);
    // Not open-ended: a bare ">=24.18.0" with no upper bound is the regression.
    expect(node.endsWith('>=24.18.0')).toBe(false);
    // Stays on the Node 24 major the project is built and verified against.
    expect(node).toMatch(/24\.18\.0/);
  });

  it('explicitly allow-lists unrs-resolver install script in .npmrc', () => {
    const npmrc = readRepo('.npmrc');
    const allowLine = npmrc
      .split('\n')
      .find((l) => l.trim().startsWith('allow-scripts'));
    expect(allowLine, '.npmrc must declare an allow-scripts allow-list').toBeDefined();
    // Covers the one legitimate build-script dependency (native resolver binding).
    expect(allowLine).toContain('unrs-resolver');
    // Must not blanket-allow every script: that weakens supply-chain security.
    expect(allowLine).not.toContain('*');
    expect(allowLine).not.toMatch(/dangerously-allow-all/);
  });

  it('does not approve unknown install scripts beyond the allow-list', () => {
    const npmrc = readRepo('.npmrc');
    // Strict mode stays OFF: the allow-list is additive, not a blanket gate
    // that would silently block legitimate scripts added by future deps.
    // (If strict were on, every future build-script dep would need a lockfile
    // change to run — a non-deterministic footgun for Vercel.)
    const strict = npmrc
      .split('\n')
      .find((l) => l.trim().startsWith('strict-allow-scripts'));
    if (strict !== undefined) {
      expect(strict.trim()).toBe('strict-allow-scripts=false');
    }
  });
});
