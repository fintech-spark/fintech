// Merchant Brain: AI tool contracts
//
// An AI tool is a CONTROLLED INTERFACE, not a database handle.
//
// What a tool must never accept from a model:
//   - raw SQL, table names, or query fragments
//   - a tenant/business identifier  (tenant identity comes from ToolContext.tenant)
//   - an unbounded filter or an unbounded date range
//   - credentials, filesystem paths, URLs, or any network target
//
// Everything the model may influence is declared as a Zod schema on the
// definition below and is validated by the registry BEFORE execute() runs.
// Tenant identity is structurally absent from every tool input schema; the
// registry additionally rejects any input that even mentions a tenant key.
//
// This phase is READ-ONLY. `readOnly` is typed as the literal `true`, so a
// mutating tool is a compile error rather than a review finding.

import type { z } from 'zod';
import type { TenantContext, UserRole } from '@/lib/types';
import type { AIToolDefinition } from '@/lib/ai/providers/types';

// ---------------------------------------------------------------------------
// Sensitivity and authorization
// ---------------------------------------------------------------------------

/**
 * How confidential a tool's output is.
 *
 * - `business_profile`  non-sensitive merchant metadata
 * - `financial`         money, revenue, margin, balances
 * - `customer_pii`      identifies or profiles a natural person
 * - `supplier_commercial` supplier identity and purchasing terms
 */
export type ToolSensitivity =
  | 'business_profile'
  | 'financial'
  | 'customer_pii'
  | 'supplier_commercial';

/** Where the numbers came from. Provenance the model must be told about. */
export type ToolDataSource = 'database' | 'analytics' | 'domain_service';

/**
 * Static authorization requirement for a tool.
 *
 * `minimumRole` is checked deterministically against `ctx.tenant.role` using
 * ROLE_RANK, so it needs no I/O and cannot be forgotten. `permission` is the
 * coarse capability the host wires to `AuthService.requirePermission`; the
 * registry passes it to the injected authorizer, which denies by default.
 */
export interface ToolAuthorization {
  readonly minimumRole: UserRole;
  readonly permission: string;
}

/** Ordered from least to most privileged. Mirrors `modules/auth` UserRole. */
export const ROLE_RANK: Readonly<Record<UserRole, number>> = {
  staff: 1,
  accountant: 2,
  manager: 3,
  admin: 4,
  owner: 5,
};

export function roleSatisfies(actual: UserRole, minimum: UserRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[minimum];
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Resource ceilings. These are denial-of-service controls, not product rules:
 * every one of them protects the database, the provider budget, or the model
 * context window from an over-eager (or hijacked) tool loop.
 */
export interface ToolLimits {
  /** Tool invocations permitted within one session. */
  readonly maxToolCalls: number;
  /** Serialized byte ceiling for a single tool payload. */
  readonly maxResultBytes: number;
  /** Row ceiling enforced inside list-shaped tool inputs. */
  readonly maxRows: number;
  /** Longest permitted reporting window, in days. */
  readonly maxDateWindowDays: number;
  /** Ceiling for any free-text argument a model supplies. */
  readonly maxTextChars: number;
  /** Wall-clock ceiling for one tool invocation. */
  readonly timeoutMs: number;
}

export const DEFAULT_TOOL_LIMITS: ToolLimits = {
  maxToolCalls: 8,
  maxResultBytes: 64 * 1024,
  maxRows: 100,
  maxDateWindowDays: 366,
  maxTextChars: 500,
  timeoutMs: 5_000,
};

// ---------------------------------------------------------------------------
// Execution context
// ---------------------------------------------------------------------------

export interface ToolContext {
  readonly tenant: TenantContext;
  readonly correlationId: string;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

/**
 * A strongly typed, read-only, tenant-scoped tool.
 *
 * `TInput`/`TOutput` are the Zod schemas, not the inferred types: the registry
 * needs the schema at runtime to parse untrusted model output, and TypeScript
 * needs it to infer the handler signature.
 */
export interface ToolDefinition<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> {
  /** Stable, versionable identifier. `snake_case`; never an internal path. */
  readonly name: string;
  /** Semantic version of this tool's contract, e.g. `v1`. */
  readonly version: string;
  /** Told to the model. Describes the question this tool answers. */
  readonly description: string;
  /** Strict schema. Unknown keys are rejected. */
  readonly inputSchema: TInput;
  /** Strict schema the handler's return value must satisfy. */
  readonly outputSchema: TOutput;
  readonly authorization: ToolAuthorization;
  readonly sensitivity: ToolSensitivity;
  /** Literal `true`: this phase introduces no mutating capability. */
  readonly readOnly: true;
  readonly source: ToolDataSource;
  /**
   * Returns the payload described by `outputSchema`. Tenant scoping, the
   * envelope, the call budget, and the timeout are the registry's job.
   */
  execute(ctx: ToolContext, input: z.output<TInput>): Promise<z.output<TOutput>>;
}

/** Backwards-compatible name for the pre-Phase-7 `Tool` export. */
export type Tool<TInput extends z.ZodType = z.ZodType, TOutput extends z.ZodType = z.ZodType> =
  ToolDefinition<TInput, TOutput>;

// ---------------------------------------------------------------------------
// Result envelope
// ---------------------------------------------------------------------------

export interface ToolReportingPeriod {
  readonly start: string;
  readonly end: string;
}

export interface ToolProvenance {
  readonly tool: string;
  readonly version: string;
  readonly source: ToolDataSource;
  readonly sensitivity: ToolSensitivity;
  readonly generatedAt: string;
  readonly reportingPeriod: ToolReportingPeriod | null;
  /** Always `true`. Present so a consumer can assert it rather than assume it. */
  readonly tenantScoped: true;
}

/**
 * Every tool result reaches the model inside this envelope, so provenance and
 * tenant scoping are structurally guaranteed rather than remembered.
 */
export interface ToolEnvelope<T = unknown> {
  readonly data: T;
  readonly provenance: ToolProvenance;
}

/**
 * A single numeric measurement with enough metadata that the model cannot
 * misread it.
 *
 * `valueMinorUnits` is an INTEGER count of minor units (paise, cents). The
 * field is named so the model cannot mistake it for rupees or a float, and
 * `currency` is always present because the schema has no single-currency
 * assumption (see: there is no FX conversion anywhere in this codebase).
 */
export interface DeterministicMetric {
  readonly metric: string;
  readonly valueMinorUnits: number;
  readonly currency: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly source: ToolDataSource;
}

/** Provenance metadata a caller may attach to its own facts. */
export interface ToolManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly sensitivity: ToolSensitivity;
  readonly permission: string;
  readonly minimumRole: UserRole;
  readonly source: ToolDataSource;
  readonly readOnly: true;
}

/** Maps a tool definition to the shape the provider layer sends to a model. */
export function toAIToolDefinition<TInput extends z.ZodType, TOutput extends z.ZodType>(
  tool: ToolDefinition<TInput, TOutput>,
  toJsonSchema: (schema: z.ZodType) => Record<string, unknown>,
): AIToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: toJsonSchema(tool.inputSchema),
  };
}

export function toManifest<TInput extends z.ZodType, TOutput extends z.ZodType>(
  tool: ToolDefinition<TInput, TOutput>,
): ToolManifest {
  return {
    name: tool.name,
    version: tool.version,
    description: tool.description,
    sensitivity: tool.sensitivity,
    permission: tool.authorization.permission,
    minimumRole: tool.authorization.minimumRole,
    source: tool.source,
    readOnly: true,
  };
}
