/**
 * Preview builder — generates inline preview data for pipeline stage arrows.
 *
 * Thin wrapper that reads from pipeline temp tables (populated by PipelineEngine
 * during report execution). For base/lk/calc stage keys, previews SELECT from
 * the corresponding pipeline temp table. For band keys, previews SELECT directly
 * from the child table (bands don't use pipeline temp tables).
 *
 * Errors are caught and returned as structured data — no uncaught exceptions
 * during render.
 */

import type { AppState } from '../types';
import { getPipelineState } from './pipeline-engine';
import { quoteId } from '../core/sqldb';
import { runPreviewQuery } from './engine';

// ── Types ───────────────────────────────────────────────────────────────────

/** Structured preview result — either data or an error message. */
export interface PreviewResult {
  /** Column headers (display labels). */
  headers: string[];
  /** Row data — each row is a record of column alias → value. */
  rows: Record<string, unknown>[];
  /** Error message if preview generation failed. Null on success. */
  error: string | null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a preview for a pipeline stage.
 *
 * For base/lk/calc keys: reads from the pipeline engine's temp tables.
 * The pipeline must have been executed (via runReport) before calling this.
 * If the pipeline hasn't reached the requested stage, returns an error.
 *
 * For band keys: reads directly from the child table (no pipeline dependency).
 *
 * @param key   - Arrow ID: "base", "lkN", "calcN", or "bandN"
 * @param state - Current AppState (used for band preview column labels)
 * @returns PreviewResult with headers, rows, and optional error
 */
export function buildPreview(key: string, state: AppState): PreviewResult {
  try {
    const lkMatch = key.match(/^lk(\d+)$/);
    const calcMatch = key.match(/^calc(\d+)$/);
    const bandMatch = key.match(/^band(\d+)$/);

    // Band preview — doesn't use pipeline temp tables, keep simple SELECT
    if (bandMatch) {
      const bandIdx = +bandMatch[1];
      const bands = state.detailBands || [];
      if (bandIdx < 0 || bandIdx >= bands.length) {
        return { headers: [], rows: [], error: 'Band not found' };
      }
      const band = bands[bandIdx];
      if (!band.rightId || !state.tables[band.rightId]) {
        return { headers: [], rows: [], error: 'Band table not found' };
      }
      const table = state.tables[band.rightId];
      const sql = `SELECT * FROM ${quoteId(band.rightId)} LIMIT 5`;
      const rows = runPreviewQuery(sql);
      // Resolve display labels using state.columnLabels
      const headers = table.cols.map(c => state.columnLabels?.[band.rightId]?.[c] ?? c);
      return { headers, rows, error: null };
    }

    // Map stage keys to pipeline stage indices
    let stageIndex: number;
    if (key === 'base') {
      stageIndex = 0;
    } else if (lkMatch) {
      stageIndex = 1; // All lookups → stage 1
    } else if (calcMatch) {
      stageIndex = 2; // All calcs → stage 2
    } else {
      return { headers: [], rows: [], error: 'Unknown stage' };
    }

    // Read from pipeline temp table
    const pipelineState = getPipelineState();
    if (stageIndex > pipelineState.validUpToStage || stageIndex >= pipelineState.tempTableNames.length) {
      return { headers: [], rows: [], error: 'Run the report to see this preview' };
    }

    const tableName = pipelineState.tempTableNames[stageIndex];
    const rows = runPreviewQuery(`SELECT * FROM ${quoteId(tableName)} LIMIT 5`);

    // Extract headers from actual result columns
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

    return { headers, rows, error: null };
  } catch (ex) {
    return { headers: [], rows: [], error: (ex as Error).message };
  }
}
