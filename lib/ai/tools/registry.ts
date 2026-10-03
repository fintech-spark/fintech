// Merchant Brain: allowlisted AI tool registry
//
// SECURITY MODEL
// --------------
// The registry is the ONLY door to a tool. A model can request a tool by name;
// it can never construct, register, or mutate one. The tool set is fixed at
// construction from an explicit array — there is no runtime `register()`.
//
// Every call passes through, in order:
//
//   1. call budget      (maxToolCalls per session)           -> RateLimitError
//   2. allowlist lookup (unknown name)                       -> NotFoundError
//   3. role gate        (deterministic, from ctx.tenant)     -> AuthorizationError
//   4. authorizer hook  (host: AuthService.requirePermission) -> AuthorizationError
//   5. tenant-key scan  (smuggled businessId/business_id)    -> ValidationError
//   6. input schema     (strict Zod)                         -> ValidationError
//   7. timeout          (wall clock)                         -> ToolExecutionError
//   8. output schema    (strict Zod)                         -> AIValidationError
//   9. payload size     (serialized bytes)                   -> ToolExecutionError
//
// Steps 3 and 4 both run. The role gate is a pure function on the
// authenticated context and cannot be forgotten; the authorizer hook is where
// the host enforces real permissions. The hook is REQUIRED — there is no
// default-allow, because an insecure default is how authorization gets skipped.
//
// Responses are wrapped in a ToolEnvelope carrying provenance and an explicit
// `tenantScoped: true`, so a consumer can assert isolation instead of assuming
// it.

import { z } from 'zod';
import {
  NotFoundError,
  ValidationError,
  AuthorizationError,
  RateLimitError,
  AIValidationError,
  ToolExecutionError,
} from '@/lib/errors';
import type { BusinessId, TenantContext } from '@/lib/types';
import type { AIToolDefinition } from '@/lib/ai/providers/types';
import { assertNoTenantKey } from './schemas';
import { roleSatisfies, toManifest } from './types';
import type {
  ToolContext,
  ToolDefinition,
  ToolEnvelope,
  ToolLimits,
  ToolManifest,
  ToolProvenance,
  ToolReportingPeriod,
} from './types';
import { DEFAULT_TOOL_LIMITS } from './types';

/** A tool whose schemas are erased. Reached only through the registry. */
export type AnyToolDefinition = ToolDefinition<z.ZodType, z.ZodType>;

/** Identity helper that preserves a literal's concrete schema types. */
export function defineTool<TInput extends z.ZodType, TOutput extends z.ZodType>(
  definition: ToolDefinition<TInput, TOutput>,
): ToolDefinition<TInput, TOutput> {
  return definition;
}

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

/**
 * One tool invocation, safe to log.
 *
 * Deliberately absent: SQL, tool input values, tool output values, customer or
 * supplier names, and any credential. Only shape and outcome are recorded.
 */
export interface ToolExecutionRecord {
  readonly tool: string;
  readonly version: string;
  readonly businessId: BusinessId;
  readonly correlationId: string;
  readonly latencyMs: number;
  readonly success: boolean;
  readonly failureCode: string | null;
  readonly resultBytes: number;
  readonly servedFromCache: boolean;
  readonly callIndex: number;
  readonly timestamp: string;
}

/**
 * Host-supplied permission check. Receives the authenticated tenant and the
 * tool's declared capability; throws `AuthorizationError` to deny.
 *
 * In production this delegates to `AuthService.requirePermission`.
 */
export type ToolAuthorizer = (tenant: TenantContext, tool: ToolManifest) => Promise<void>;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * A per-request handle holding the call budget and a small result cache, so a
 * model that loops on the same expensive query is charged once.
 */
export interface ToolSession {
  readonly callCount: number;
  call<T = unknown>(name: string, rawInput: unknown): Promise<ToolEnvelope<T>>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface ToolRegistry {
  readonly limits: ToolLimits;
  list(): readonly ToolManifest[];
  has(name: string): boolean;
  /** Provider-facing definitions for the approved tools only. */
  definitions(): readonly AIToolDefinition[];
  open(tenant: TenantContext): ToolSession;
}

export interface CreateToolRegistryOptions {
  /** The complete, explicit allowlist. Nothing outside this array is callable. */
  readonly tools: readonly AnyToolDefinition[];
  readonly limits?: Partial<ToolLimits>;
  /** Required. Deny-by-default is enforced by making this non-optional. */
  readonly authorize: ToolAuthorizer;
  readonly now?: () => Date;
  readonly onRecord?: (record: ToolExecutionRecord) => void;
}

export function createToolRegistry(options: CreateToolRegistryOptions): ToolRegistry {
  const { tools, authorize, onRecord, now = () => new Date() } = options;
  const limits: ToolLimits = { ...DEFAULT_TOOL_LIMITS, ...options.limits };

  const byName = new Map<string, AnyToolDefinition>();
  for (const tool of tools) {
    assertToolName(tool.name);
    if (byName.has(tool.name)) {
      throw new Error(`duplicate tool name in allowlist: ${tool.name}`);
    }
    if (tool.readOnly !== true) {
      throw new Error(`tool ${tool.name} is not read-only; this phase permits no writes`);
    }
    byName.set(tool.name, tool);
  }

  const manifests = new Map<string, ToolManifest>();
  for (const [name, tool] of byName) manifests.set(name, toManifest(tool));

  function open(tenant: TenantContext): ToolSession {
    const context: ToolContext = { tenant, correlationId: tenant.correlationId };
    const cache = new Map<string, ToolEnvelope<unknown>>();
    let callCount = 0;

    function emit(
      name: string,
      version: string,
      startedAt: number,
      success: boolean,
      failureCode: string | null,
      resultBytes: number,
      servedFromCache: boolean,
    ): void {
      if (!onRecord) return;
      onRecord({
        tool: name,
        version,
        businessId: tenant.businessId,
        correlationId: tenant.correlationId,
        latencyMs: now().getTime() - startedAt,
        success,
        failureCode,
        resultBytes,
        servedFromCache,
        callIndex: callCount,
        timestamp: new Date(startedAt).toISOString(),
      });
    }

    async function call<T = unknown>(
      name: string,
      rawInput: unknown,
    ): Promise<ToolEnvelope<T>> {
      callCount += 1;
      const startedAt = now().getTime();
      const tool = byName.get(name);

      try {
        if (callCount > limits.maxToolCalls) {
          throw new RateLimitError(
            `tool call budget exhausted (${limits.maxToolCalls} calls per request)`,
          );
        }
        if (!tool) throw new NotFoundError(`unknown tool: ${name}`);
        const manifest = manifests.get(name);
        if (!manifest) throw new NotFoundError(`unknown tool: ${name}`);

        if (!roleSatisfies(tenant.role, tool.authorization.minimumRole)) {
          throw new AuthorizationError(`role "${tenant.role}" may not call tool "${name}"`);
        }
        await authorize(tenant, manifest);

        const input = parseInput(name, tool, rawInput);

        const cacheKey = `${name}:${JSON.stringify(input)}`;
        const cached = cache.get(cacheKey);
        if (cached) {
          emit(name, tool.version, startedAt, true, null, 0, true);
          return cached as ToolEnvelope<T>;
        }

        const payload = await withTimeout(
          name,
          tool.execute(context, input as never),
          limits.timeoutMs,
        );
        const validated = validateOutput(name, tool, payload);
        const envelope = buildEnvelope(name, tool, validated);

        const resultBytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
        if (resultBytes > limits.maxResultBytes) {
          throw new ToolExecutionError(
            `tool "${name}" produced ${resultBytes} bytes, above the ${limits.maxResultBytes} byte limit`,
          );
        }

        cache.set(cacheKey, envelope);
        emit(name, tool.version, startedAt, true, null, resultBytes, false);
        return envelope as ToolEnvelope<T>;
      } catch (error) {
        const version = tool?.version ?? 'unknown';
        emit(name, version, startedAt, false, errorCodeOf(error), 0, false);
        throw error;
      }
    }

    return {
      get callCount(): number {
        return callCount;
      },
      call,
    };
  }

  return {
    limits,
    list: () => Array.from(manifests.values()),
    has: (name: string) => byName.has(name),
    definitions: () =>
      Array.from(byName.values()).map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.inputSchema, {
          io: 'input',
        }) as Record<string, unknown>,
      })),
    open,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

function assertToolName(name: string): void {
  if (!TOOL_NAME_PATTERN.test(name)) {
    throw new Error(
      `tool name "${name}" must be lower snake_case so it stays stable and non-leaky`,
    );
  }
}

function parseInput(name: string, tool: AnyToolDefinition, rawInput: unknown): unknown {
  const candidate = rawInput === undefined || rawInput === null ? {} : rawInput;
  if (typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new ValidationError(`tool "${name}" requires an object argument`);
  }

  try {
    assertNoTenantKey(candidate);
  } catch (error) {
    throw new ValidationError((error as Error).message);
  }

  const result = tool.inputSchema.safeParse(candidate);
  if (!result.success) {
    throw new ValidationError(
      `invalid input for tool "${name}": ${formatIssues(result.error)}`,
    );
  }
  return result.data;
}

function validateOutput(name: string, tool: AnyToolDefinition, payload: unknown): unknown {
  const result = tool.outputSchema.safeParse(payload);
  if (!result.success) {
    // Deliberately does not echo the payload: it may contain merchant data.
    throw new AIValidationError(
      `tool "${name}" returned a payload that failed its output schema`,
      { tool: name, issues: formatIssues(result.error) },
    );
  }
  return result.data;
}

function buildEnvelope(
  name: string,
  tool: AnyToolDefinition,
  payload: unknown,
): ToolEnvelope<unknown> {
  const provenance: ToolProvenance = {
    tool: name,
    version: tool.version,
    source: tool.source,
    sensitivity: tool.sensitivity,
    generatedAt: new Date().toISOString(),
    reportingPeriod: extractPeriod(payload),
    tenantScoped: true,
  };
  return { data: payload, provenance };
}

/**
 * Reads a reporting period out of a tool payload when it declares one.
 *
 * A number without a period is ambiguous, so provenance carries the window
 * whenever the payload exposes one. Absent a window it is explicitly `null`
 * rather than a guess.
 */
function extractPeriod(payload: unknown): ToolReportingPeriod | null {
  if (payload === null || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;

  if (typeof record.periodStart === 'string' && typeof record.periodEnd === 'string') {
    return { start: record.periodStart, end: record.periodEnd };
  }
  const period = record.period;
  if (period !== null && typeof period === 'object') {
    const nested = period as Record<string, unknown>;
    if (typeof nested.start === 'string' && typeof nested.end === 'string') {
      return { start: nested.start, end: nested.end };
    }
  }
  return null;
}

async function withTimeout<T>(name: string, work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new ToolExecutionError(`tool "${name}" exceeded its ${timeoutMs}ms budget`, {
            tool: name,
            reason: 'timeout',
          }),
        ),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function errorCodeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'UNKNOWN';
}
