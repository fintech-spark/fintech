// Merchant Brain: evaluation graders
//
// A grader is a named, deterministic predicate over one graded artefact.
// Graders never repair, normalise, or coerce: they state pass/fail and why.
//
// Thresholds are never invented here. Each case declares what it expects, and a
// grader only reports whether reality matched that declaration.

export interface Grade {
  readonly grader: string;
  readonly passed: boolean;
  readonly detail: string;
}

export type Grader<T> = (subject: T) => Grade;

export function grade(grader: string, passed: boolean, detail: string): Grade {
  return { grader, passed, detail };
}

/** Asserts an exact status match. Used for the fixture `expectedStatus`. */
export function expectStatus(
  actual: string,
  expected: string,
): Grade {
  return grade(
    'status',
    actual === expected,
    actual === expected
      ? `status ${actual}`
      : `expected ${expected}, got ${actual}`,
  );
}

/** Asserts a contradiction was reported, optionally matching a fragment. */
export function expectContradiction(
  contradictions: readonly string[] | undefined,
  fragment?: string,
): Grade {
  const list = contradictions ?? [];
  if (list.length === 0) {
    return grade('contradiction', false, 'no contradiction reported');
  }
  if (!fragment) {
    return grade('contradiction', true, `${list.length} contradiction(s)`);
  }
  const hit = list.some((c) => c.toLowerCase().includes(fragment.toLowerCase()));
  return grade(
    'contradiction',
    hit,
    hit ? `matched "${fragment}"` : `none matched "${fragment}": ${list.join(' | ')}`,
  );
}

/** Asserts no contradiction was reported. */
export function expectNoContradiction(
  contradictions: readonly string[] | undefined,
): Grade {
  const list = contradictions ?? [];
  return grade(
    'no-contradiction',
    list.length === 0,
    list.length === 0 ? 'clean' : `unexpected: ${list.join(' | ')}`,
  );
}

/** Asserts specific required fields were reported missing. */
export function expectMissingFields(
  missing: readonly string[] | undefined,
  fields: readonly string[],
): Grade {
  const list = missing ?? [];
  const absent = fields.filter((f) => !list.includes(f));
  return grade(
    'missing-fields',
    absent.length === 0,
    absent.length === 0
      ? `all ${fields.length} reported missing`
      : `not reported missing: ${absent.join(', ')}`,
  );
}

/** Asserts at least one evidence item was produced. */
export function expectEvidence(
  evidence: readonly unknown[],
  min = 1,
): Grade {
  return grade(
    'evidence',
    evidence.length >= min,
    evidence.length >= min
      ? `${evidence.length} evidence item(s)`
      : `expected >=${min}, got ${evidence.length}`,
  );
}

/** Asserts no evidence was produced. */
export function expectNoEvidence(evidence: readonly unknown[]): Grade {
  return grade(
    'no-evidence',
    evidence.length === 0,
    evidence.length === 0 ? 'none' : `unexpected ${evidence.length}`,
  );
}

/** Asserts a text does NOT contain a forbidden fragment. Used for injection cases. */
export function expectAbsent(haystack: string, needle: string, label: string): Grade {
  const present = haystack.toLowerCase().includes(needle.toLowerCase());
  return grade(
    label,
    !present,
    present ? `found forbidden "${needle}"` : `absent "${needle}"`,
  );
}

/** Asserts a text DOES contain a required fragment. */
export function expectPresent(haystack: string, needle: string, label: string): Grade {
  const present = haystack.toLowerCase().includes(needle.toLowerCase());
  return grade(
    label,
    present,
    present ? `found "${needle}"` : `missing "${needle}"`,
  );
}

/** Asserts a numeric value is within tolerance of an expected figure. */
export function expectNumber(
  actual: number | undefined,
  expected: number,
  tolerance = 0,
  label = 'number',
): Grade {
  if (actual === undefined || !Number.isFinite(actual)) {
    return grade(label, false, `expected ${expected}, got ${actual}`);
  }
  const ok = Math.abs(actual - expected) <= tolerance;
  return grade(
    label,
    ok,
    ok ? `${actual}` : `expected ${expected}±${tolerance}, got ${actual}`,
  );
}