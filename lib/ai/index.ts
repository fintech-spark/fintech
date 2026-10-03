export type {
  AIProvider,
  ModelRole,
  ModelConfig,
  CompletionRequest,
  CompletionResponse,
  AIMessage,
  AIContentPart,
  AIToolDefinition,
  AIToolCall,
  TokenUsage,
  EmbeddingRequest,
  EmbeddingResponse,
  AIProviderAdapter,
} from './providers/types';

export { createModelRegistry } from './router';
export type { ModelRegistry } from './router';

export { createToolRegistry, defineTool } from './tools/registry';
export type {
  AnyToolDefinition,
  CreateToolRegistryOptions,
  ToolAuthorizer,
  ToolExecutionRecord,
  ToolRegistry,
  ToolSession,
} from './tools/registry';

export type {
  DeterministicMetric as ToolDeterministicMetric,
  Tool,
  ToolAuthorization,
  ToolContext,
  ToolDataSource,
  ToolDefinition,
  ToolEnvelope,
  ToolLimits,
  ToolManifest,
  ToolProvenance,
  ToolReportingPeriod,
  ToolSensitivity,
} from './tools/types';
export { DEFAULT_TOOL_LIMITS, ROLE_RANK, roleSatisfies, toManifest, toAIToolDefinition } from './tools/types';

export {
  FORBIDDEN_TENANT_KEYS,
  assertNoTenantKey,
  boundedDateRangeSchema,
  boundedLimitSchema,
  boundedTextSchema,
  currencySchema,
  deterministicMetricSchema,
  isoDateSchema,
  minorUnitsSchema,
  reportingPeriodSchema,
  searchTermSchema,
} from './tools/schemas';

export { guardOutput, guardJSON } from './guards';
export type { GuardResult } from './guards';

export { createAITelemetry } from './telemetry';
export type { AITelemetry, AIOperationRecord } from './telemetry';
