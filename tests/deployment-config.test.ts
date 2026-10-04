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

  it('explicitly allow-lists unrs-resolver install script in package.json allowScripts', () => {
    const pkg = JSON.parse(readRepo('package.json'));
    const allowScripts = pkg.allowScripts ?? {};
    const unrsKey = Object.keys(allowScripts).find((k) => k.startsWith('unrs-resolver'));
    expect(unrsKey, 'package.json must declare unrs-resolver in allowScripts').toBeDefined();
    expect(allowScripts[unrsKey!]).toBe(true);
  });
});
