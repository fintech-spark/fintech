import type { TenantContext, PaginatedResult, PaginationParams } from '@/lib/types';
import type { Scenario, ScenarioParameter, ScenarioStatus } from '../domain/types';
export interface SimulatorService {
  runScenario(ctx: TenantContext, input: RunScenarioInput): Promise<Scenario>;
  getById(ctx: TenantContext, scenarioId: string): Promise<Scenario | null>;
  list(ctx: TenantContext, filters: ScenarioFilters): Promise<PaginatedResult<Scenario>>;
}
export interface RunScenarioInput { readonly name: string; readonly description?: string; readonly parameters: readonly ScenarioParameter[]; }
export interface ScenarioFilters extends PaginationParams { readonly status?: ScenarioStatus; }
