/**
 * Type declarations for scripts/migrate.mjs so that TypeScript consumers
 * (tests/database-migration-integrity.test.ts) get real types instead of an
 * implicit any while the implementation stays plain ESM JavaScript.
 */

export interface MigrationFile {
  filename: string;
  content: string;
  checksum: string;
}

export interface AppliedMigration {
  filename: string;
  checksum: string;
}

export interface DriftEntry {
  filename: string;
  problem: 'missing' | 'modified' | 'unverified';
  blocking: boolean;
  message: string;
}

export function findDrift(applied: AppliedMigration[], onDisk: MigrationFile[]): DriftEntry[];
