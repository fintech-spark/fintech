/**
 * Type declarations for scripts/import-phonepe-pulse.mjs so TypeScript
 * consumers (tests/phonepe-pulse/importer.test.ts) get real types while the
 * implementation stays plain ESM JavaScript.
 */

export type PulseCategory = 'aggregated' | 'map' | 'top';
export type PulseDataset = 'transaction' | 'user' | 'merchant';
export type PulseGeoLevel = 'country' | 'state' | 'district';

export interface SourcePath {
  readonly ok: true;
  readonly category: PulseCategory;
  readonly dataset: PulseDataset;
  readonly scope: 'country' | 'state';
  readonly stateSlug: string | null;
  readonly year: number;
  readonly quarter: number;
  readonly scopeGeoName: string;
}

export interface SourcePathError {
  readonly ok: false;
  readonly reason: string;
}

export type SourcePathResult = SourcePath | SourcePathError;

export interface PulseRow {
  readonly sourceKey: string;
  readonly sourceFile: string;
  readonly datasetType: PulseDataset;
  readonly category: PulseCategory;
  readonly scope: 'country' | 'state';
  readonly year: number;
  readonly quarter: number;
  readonly geoLevel: PulseGeoLevel;
  readonly geoName: string;
  readonly parentGeoName: string | null;
  readonly segment: string | null;
  readonly metricType: string | null;
  readonly rank: number | null;
  readonly transactionCount: number | null;
  readonly transactionAmount: number | null;
  readonly registeredCount: number | null;
}

export interface ParsePulseFileResult {
  readonly rows: readonly PulseRow[];
  readonly warnings: readonly string[];
  readonly dropped: number;
}

export interface ImportOptions {
  readonly root: string;
  readonly dryRun?: boolean;
  readonly limit?: number | null;
  readonly batch?: number;
  readonly target?: 'remote' | 'local';
  readonly quiet?: boolean;
}

export interface ImportStats {
  readonly filesProcessed: number;
  readonly filesFailed: number;
  readonly filesSkipped: number;
  readonly filesExamined: number;
  readonly totalFiles: number;
  readonly rowsParsed: number;
  readonly rowsDropped: number;
  readonly rowsInserted: number;
  readonly rowsUpdated: number;
  readonly rowsRejected: number;
  readonly warnings: number;
  readonly byDataset: Readonly<Record<PulseDataset, number>>;
  readonly rejections: readonly string[];
  readonly runtimeMs: number;
  readonly dryRun: boolean;
}

export function parseSourcePath(relativePath: string): SourcePathResult;
export function slugToName(slug: string): string;
export function normalizeName(name: string): string;
export function buildSourceKey(
  meta: Omit<SourcePath, 'ok' | 'stateSlug' | 'scopeGeoName'>,
  row: Pick<PulseRow, 'geoLevel' | 'geoName' | 'segment' | 'metricType'>,
): string;
export function parsePulseFile(relativePath: string, payload: unknown): ParsePulseFileResult;
export function importPulseData(options: ImportOptions): Promise<ImportStats>;
