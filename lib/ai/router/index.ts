/**
 * Model Router
 *
 * Routes AI tasks to the appropriate model/provider based on the task's
 * model role. Centralizes model configuration and provider selection.
 */

import type { ModelConfig, ModelRole } from '../providers/types';

/** Model registry mapping roles to configurations */
export interface ModelRegistry {
  getModel(role: ModelRole): ModelConfig;
  listModels(): ModelConfig[];
}

/**
 * Creates a model registry from environment-based configuration.
 * Model assignments are centralized here — business modules never
 * hardcode model IDs or provider names.
 */
export function createModelRegistry(
  config: Record<ModelRole, ModelConfig>,
): ModelRegistry {
  return {
    getModel(role: ModelRole): ModelConfig {
      const model = config[role];
      if (!model) throw new Error(`No model configured for role: ${role}`);
      return model;
    },
    listModels(): ModelConfig[] {
      return Object.values(config);
    },
  };
}
