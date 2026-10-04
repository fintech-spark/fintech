export const MODULE_DEPENDENCIES: Record<string, readonly string[]> = {
  auth: [],
  businesses: [],
  transactions: [],
  expenses: [],
  inventory: [],
  customers: [],
  suppliers: [],
  documents: [],
  ingestion: ['documents'],
  extraction: ['documents'],
  analytics: ['transactions', 'expenses', 'inventory', 'customers', 'suppliers'],
  'profit-leaks': ['analytics', 'transactions', 'expenses', 'inventory', 'suppliers'],
  'cash-flow': ['analytics', 'transactions', 'expenses', 'customers', 'suppliers'],
  simulator: ['analytics'],
  rag: ['documents'],
  // business-brain is the AI read/reasoning layer. Phase 7 gave it the
  // structured-domain edges it needs to answer merchant questions with
  // deterministic facts: the five leaves below are all dependency-free, so
  // adding them keeps the graph acyclic. Write edges remain absent — this
  // module retrieves and analyses, it never mutates.
  'business-brain': [
    'rag',
    'analytics',
    'profit-leaks',
    'cash-flow',
    'actions',
    'transactions',
    'inventory',
    'customers',
    'suppliers',
    'expenses',
    'businesses',
    'documents',
  ],
  actions: [],
  notifications: [],
  audit: [],
  // `evidence` and `validation` existed on disk but were absent from this map,
  // which made `isAllowedImport` return false for EVERY edge out of them — a
  // silent quarantine rather than a visible failure. Declared here with their
  // real (currently empty) dependency sets so they are ordinary participants.
  //
  // `evidence` depends on nothing: it defines the claim envelope contract.
  evidence: [],
  // `validation` is pure Zod field validation over records; no module edges.
  validation: [],
} as const;

export function isAllowedImport(fromModule: string, toModule: string): boolean {
  if (toModule === 'lib') return true;
  if (fromModule === toModule) return true;
  const allowedDeps = MODULE_DEPENDENCIES[fromModule];
  if (!allowedDeps) return false;
  return allowedDeps.includes(toModule);
}

export function detectCircularDependencies(): string[] | null {
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(modName: string, path: string[]): string[] | null {
    if (stack.has(modName)) return [...path, modName];
    if (visited.has(modName)) return null;

    visited.add(modName);
    stack.add(modName);

    const deps = MODULE_DEPENDENCIES[modName] ?? [];
    for (const dep of deps) {
      const cycle = dfs(dep, [...path, modName]);
      if (cycle) return cycle;
    }

    stack.delete(modName);
    return null;
  }

  for (const modName of Object.keys(MODULE_DEPENDENCIES)) {
    const cycle = dfs(modName, []);
    if (cycle) return cycle;
  }

  return null;
}
