/**
 * Source table catalog — builds a catalog of imported database tables.
 *
 * Maps raw table definitions (from AppState) into SourceTableEntry objects
 * that downstream modules (column-catalog, query-builder) use to resolve
 * table metadata and column references.
 */

import type { DbTable } from '../types';

/** A single imported table entry with its metadata and column list. */
export interface SourceTableEntry {
  id: string;
  name: string;
  cols: string[];
  kind: 'imported';
  source: DbTable;
}

/**
 * Build a source table catalog from raw table definitions.
 *
 * @param tables - Table definitions keyed by table ID (from AppState.tables).
 * @returns A Map from table ID to SourceTableEntry with id, name, columns,
 *   and the original DbTable reference.
 */
export function buildSourceCatalog(
  tables: Record<string, DbTable>,
): Map<string, SourceTableEntry> {
  const catalog = new Map<string, SourceTableEntry>();

  for (const [tid, table] of Object.entries(tables)) {
    catalog.set(tid, {
      id: tid,
      name: table.name || tid,
      cols: table.cols || [],
      kind: 'imported',
      source: table,
    });
  }

  return catalog;
}
