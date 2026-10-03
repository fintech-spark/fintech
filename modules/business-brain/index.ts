export type {
  BrainQuery,
  BrainResponse,
  ToolCallRecord,
  EvidenceReference,
  EvidenceSourceType,
  ConversationMessage,
  ResponseMetadata,
} from './domain/types';

export type {
  AIContext,
  AuthoritativeFact,
  ContextConflict,
  ContextMetadata,
  ContextUncertainty,
  DeterministicMetricRecord,
  FactSource,
  KnowledgeKind,
  RetrievedEvidence,
  SourceReference,
} from './domain/context';
export { isInsufficientEvidence } from './domain/context';

export type {
  EvidenceItem,
  EvidencePacket,
  EvidenceType,
} from './domain/evidence';
export {
  EvidenceRegistry,
  evidenceId,
  factFromEnvelope,
  metricFromRecord,
  metricSource,
  toolSource,
} from './domain/evidence';

export type { BusinessBrainService } from './application/service';
export { DefaultBusinessBrainService } from './application/service';

export {
  compileContext,
  DEFAULT_CONTEXT_BUDGET,
} from './application/context-compiler';
export type {
  CompileInput,
  CompileOutput,
  ContextBudget,
} from './application/context-compiler';

export { ContextAssembler, planToolCalls } from './application/context-assembler';
export type {
  AssemblyRequest,
  AssemblyResult,
  AssemblerDependencies,
} from './application/context-assembler';

export {
  assembleContextPrompt,
  buildContextSystemPrompt,
  CONTEXT_PROMPT_VERSION,
} from './application/prompt-builder';
export type { AssembledPrompt } from './application/prompt-builder';

export {
  neutraliseDelimiters,
  wrapUntrusted,
  UNTRUSTED_CLOSE,
  UNTRUSTED_OPEN,
} from './application/untrusted';
export type { UntrustedLabels } from './application/untrusted';

export { createBusinessReadOnlyTools } from './application/tools';

export {
  assertTenantPredicate,
  MissingTenantPredicateError,
  tenantQuery,
} from './infrastructure/tenant-query';
export type { TenantScope } from './infrastructure/tenant-query';
