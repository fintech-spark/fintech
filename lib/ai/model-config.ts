// Merchant Brain: model role -> environment variable mapping
//
// Fixes a latent divergence: this file declared its own four-value `ModelRole`
// while `lib/ai/providers/types.ts` declared a five-value one that included
// `'embedding'`. Nothing re-exported both, so the collision stayed dormant —
// until the RAG phase needed an embedding model and found no env key for it.
//
// `ModelRole` is now imported from the provider types rather than redeclared,
// and the embedding role has a key. `AI_MODEL_EMBEDDING` is documented in
// `.env.example`.

import type { ModelRole } from './providers/types';

export type { ModelRole };

/** Every role a caller may resolve. Includes `embedding` for the RAG pipeline. */
export const modelRoles: readonly ModelRole[] = [
  'multimodal',
  'reasoning',
  'fast',
  'reviewer',
  'embedding',
];

const environmentKeys: Readonly<Record<ModelRole, string>> = {
  multimodal: 'AI_MODEL_MULTIMODAL',
  reasoning: 'AI_MODEL_REASONING',
  fast: 'AI_MODEL_FAST',
  reviewer: 'AI_MODEL_REVIEWER',
  embedding: 'AI_MODEL_EMBEDDING',
};

/**
 * Reads the configured model id for a role.
 *
 * Returns `undefined` for unset or whitespace-only values so the caller can fall
 * back to a vendor default. This reads `process.env` directly rather than going
 * through `requireEnv`: a missing override is a legitimate configuration, not a
 * startup failure. Credentials are validated separately by the provider adapter.
 */
export function getConfiguredModelId(role: ModelRole): string | undefined {
  const value = process.env[environmentKeys[role]]?.trim();
  return value && value.length > 0 ? value : undefined;
}

/** Roles with no configured override. Useful for a startup readiness check. */
export function getMissingModelRoles(): ModelRole[] {
  return modelRoles.filter((role) => !getConfiguredModelId(role));
}

/** The environment variable backing a role. Exported for diagnostics. */
export function environmentKeyForRole(role: ModelRole): string {
  return environmentKeys[role];
}
