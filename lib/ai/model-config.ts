export const modelRoles = [
  "multimodal",
  "reasoning",
  "fast",
  "reviewer",
] as const;

export type ModelRole = (typeof modelRoles)[number];

const environmentKeys: Record<ModelRole, string> = {
  multimodal: "AI_MODEL_MULTIMODAL",
  reasoning: "AI_MODEL_REASONING",
  fast: "AI_MODEL_FAST",
  reviewer: "AI_MODEL_REVIEWER",
};

export function getConfiguredModelId(role: ModelRole): string | undefined {
  const key = environmentKeys[role];
  const value = process.env[key]?.trim();
  return value || undefined;
}

export function getMissingModelRoles(): ModelRole[] {
  return modelRoles.filter((role) => !getConfiguredModelId(role));
}
