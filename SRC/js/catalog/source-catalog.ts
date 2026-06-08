import { db } from '../core/state.js';

interface PublishedOutput {
  name?: string;
  columns?: string[];
  rows?: unknown[];
}

export interface CatalogEntry {
  id: string;
  name: string;
  cols: string[];
  rows: unknown[];
  kind: 'imported' | 'report';
  source: unknown;
}

export function buildSourceCatalog(
  workspaceState?: { tables?: Record<string, { name?: string; cols?: string[]; rows?: unknown[] }> },
  upstreamOutputs?: Map<string, PublishedOutput>,
): Map<string, CatalogEntry> {
  const catalog = new Map<string, CatalogEntry>();

  const tables = (workspaceState && workspaceState.tables) || (db && db.tables) || {};
  for (const [tid, table] of Object.entries(tables)) {
    catalog.set(tid, {
      id:     tid,
      name:   table.name  || tid,
      cols:   table.cols  || [],
      rows:   table.rows  || [],
      kind:   'imported',
      source: table,
    });
  }

  if (upstreamOutputs) {
    for (const [outputId, output] of upstreamOutputs.entries()) {
      catalog.set(outputId, {
        id:     outputId,
        name:   output.name    || outputId,
        cols:   output.columns || [],
        rows:   output.rows    || [],
        kind:   'report',
        source: output,
      });
    }
  }

  return catalog;
}

export function getTable(catalog: Map<string, CatalogEntry>, tid: string): CatalogEntry | null {
  return (catalog instanceof Map ? catalog.get(tid) : null) || null;
}

export function getTableColumns(catalog: Map<string, CatalogEntry>, tid: string): string[] {
  const entry = getTable(catalog, tid);
  return entry ? entry.cols : [];
}

export function getTableLabel(catalog: Map<string, CatalogEntry>, tid: string): string {
  const entry = getTable(catalog, tid);
  return entry ? entry.name : tid;
}

export function getColumn(catalog: Map<string, CatalogEntry>, tid: string, col: string): { col: string; tid: string } | null {
  const cols = getTableColumns(catalog, tid);
  return cols.includes(col) ? { col, tid } : null;
}

export function resolveSourceTableRef(catalog: Map<string, CatalogEntry>, ref: string): CatalogEntry | null {
  return getTable(catalog, ref);
}

export function resolveSourceColumnRef(catalog: Map<string, CatalogEntry>, ref: { tid?: string; col?: string }): { col: string; tid: string } | null {
  if (!ref || !ref.tid || !ref.col) return null;
  return getColumn(catalog, ref.tid, ref.col);
}
