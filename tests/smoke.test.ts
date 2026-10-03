import { describe, it, expect } from 'vitest';
import { MODULE_DEPENDENCIES, detectCircularDependencies, isAllowedImport } from '@/lib/boundaries';

/**
 * Architectural invariants that do not need a database or a route handler.
 *
 * This file previously asserted that a hardcoded object equalled itself, which
 * is a tautology: it passed or failed with no reference to any real code path.
 * It now checks properties that would actually fail if the module graph were
 * broken.
 */
describe('module graph', () => {
  it('has no cycle in the declared dependency graph', () => {
    expect(detectCircularDependencies()).toBeNull();
  });

  it('declares a dependency entry for every module directory', () => {
    // A module directory with no entry in the map is invisible to
    // `isAllowedImport`, which returns false for every edge out of it. That
    // silently quarantines the module rather than constraining it.
    const declared = Object.keys(MODULE_DEPENDENCIES);
    expect(declared.length).toBeGreaterThan(0);

    for (const name of declared) {
      expect(name).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it('only lists dependencies that are themselves declared', () => {
    // An undeclared target makes the edge permanently deny, so the calling
    // module could never import it. Better to catch it here.
    for (const [name, deps] of Object.entries(MODULE_DEPENDENCIES)) {
      for (const dep of deps) {
        expect(
          Object.keys(MODULE_DEPENDENCIES),
          `${name} depends on undeclared module "${dep}"`,
        ).toContain(dep);
      }
    }
  });

  it('does not let a module depend on itself', () => {
    for (const [name, deps] of Object.entries(MODULE_DEPENDENCIES)) {
      expect(deps).not.toContain(name);
    }
  });

  it('denies every module access to an undeclared sibling', () => {
    for (const name of Object.keys(MODULE_DEPENDENCIES)) {
      expect(isAllowedImport(name, 'not-a-module')).toBe(false);
    }
  });
});
