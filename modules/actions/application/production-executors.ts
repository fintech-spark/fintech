import { AuthorizationError, ValidationError } from '@/lib/errors';
import type { DateRange, TenantContext } from '@/lib/types';
import type { Action } from '../domain/types';
import { ActionExecutorRegistry, validateActionParameters, type ExecutorContext, type ExecutorOutcome } from '../domain/executors';

/** Narrow capabilities supplied by the composition root; no sibling imports. */
export interface InternalActionCapabilities {
  generateReport(action: Action, ctx: TenantContext, period: DateRange, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>>;
  adjustPrice(action: Action, ctx: TenantContext, productId: string, newPriceMinor: number, signal?: AbortSignal): Promise<string>;
  changeSupplier(action: Action, ctx: TenantContext, productId: string, supplierId: string, signal?: AbortSignal): Promise<string>;
}

export function createProductionActionExecutorRegistry(capabilities: InternalActionCapabilities): ActionExecutorRegistry {
  const registry = new ActionExecutorRegistry();
  registry.register({ executorId: 'internal:generate-report:v1', handles: 'generate_report', execute: async (action, context) => {
    validate(action, context);
    const data = await capabilities.generateReport(action, context.tenant, {
      from: new Date(action.parameters.from as string), to: new Date(action.parameters.to as string),
    }, context.signal);
    return { success: true, output: 'Report generated from business records.', data };
  } });
  registry.register({ executorId: 'internal:adjust-price:v1', handles: 'adjust_price', execute: async (action, context) => {
    validate(action, context);
    const id = await capabilities.adjustPrice(action, context.tenant, uuid(action.parameters.productId), action.parameters.newPriceMinor as number, context.signal);
    return productOutcome(id, 'Product selling price updated.');
  } });
  registry.register({ executorId: 'internal:change-supplier:v1', handles: 'change_supplier', execute: async (action, context) => {
    validate(action, context);
    const id = await capabilities.changeSupplier(action, context.tenant, uuid(action.parameters.productId), uuid(action.parameters.supplierId), context.signal);
    return productOutcome(id, 'Product supplier updated.');
  } });
  // No purchase-order adapter or external delivery integration exists. Leave
  // those types unregistered: execution returns no_registered_executor.
  return registry.freeze();
}

function validate(action: Action, context: ExecutorContext): void {
  if (context.tenant.role !== 'owner' || action.businessId !== context.tenant.businessId) {
    throw new AuthorizationError('Execution requires the business owner.');
  }
  context.signal?.throwIfAborted();
  validateActionParameters(action);
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError('Action target must be a UUID.');
  }
  return value;
}

function productOutcome(id: string, output: string): ExecutorOutcome {
  return { success: true, output, affectedResources: [{ type: 'product', id }] };
}
