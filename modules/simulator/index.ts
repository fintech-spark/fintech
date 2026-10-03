// Public API of the simulator module.
//
// Consumers import from `@/modules/simulator` only.
//
// Contract summary:
//
//   * A scenario is HYPOTHETICAL. `isProjection` is `true`, the result is written
//     only to the `scenarios` table, and no interface in this module can reach
//     products, prices, stock, invoices or payments.
//   * The engine in `domain/rules.ts` is a pure function of (baseline, parameters).
//     Identical inputs always produce an identical projection.
//   * Every result carries `assumptions`, each with an explicit `limitation`, and
//     the three baseline assumptions that always apply.
//   * A parameter outside its bounds is REJECTED, not silently clamped, so a
//     caller cannot receive a projection for a different question than it asked.
//   * `comparison.direction` is `unavailable` when baseline profit is zero, so
//     "no change" is never claimed about a figure that does not exist.

export type {
  ParameterType,
  ParameterUnit,
  RunScenarioInput,
  Scenario,
  ScenarioAssumption,
  ScenarioCashTiming,
  ScenarioComparison,
  ScenarioFilters,
  ScenarioInvalidReason,
  ScenarioParameter,
  ScenarioRejection,
  ScenarioSnapshot,
  ScenarioStatus,
} from './domain/types';

export {
  applyCostChange,
  applyPriceChange,
  BASELINE_ASSUMPTIONS,
  compareSnapshots,
  EMPTY_SNAPSHOT,
  MAX_ORDER_QUANTITY,
  MAX_PERCENTAGE_CHANGE_BPS,
  MAX_TIMING_SHIFT_DAYS,
  normaliseSnapshot,
  parameterChangeBps,
  runScenarioEngine,
  validateParameterBounds,
  type EngineResult,
} from './domain/rules';

export type { SimulatorService } from './application/postgres-simulator-service';

export {
  MIN_RECOMPUTE_WINDOW_MS,
  PostgresSimulatorService,
  toScenarioSnapshot,
  trailingWindow,
  validateParameters,
  type ScenarioRepository,
} from './application/postgres-simulator-service';

export { PostgresScenarioRepository } from './infrastructure/postgres-scenario-repository';