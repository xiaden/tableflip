/**
 * Result set construction.
 *
 * Builds the canonical { columns, rows, metadata } structure returned by
 * the report execution engine.  Pure function — no global state dependency.
 *
 * Ported from SRC/js/report/result-set.ts — zero imports from SRC/js/.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Metadata attached to every result set.
 * @property rowCount - Number of data rows in the result
 * @property generatedAt - Timestamp (ms) when the result was built
 * @property aggMode - Aggregation mode used for this query ('none', 'group', 'totals', 'subtotals')
 * @property displayCols - Explicit display column list ([] = use columns array as-is)
 * @property totalsRow - Aggregate totals row (present when aggMode is 'totals')
 * @property hasSubtotals - Whether subtotal rows are included
 * @property allCols - Full column list before output-column filtering
 * @property bandCount - Number of detail bands in the result (present when detail bands are active)
 * @property bandIds - IDs of the detail bands included in the result
 * @property bandLabels - Map from band ID to user-visible label for section headers
 */
export interface ResultSetMetadata {
  rowCount: number;
  generatedAt: number;
  aggMode: string;
  displayCols: string[];
  totalsRow?: Record<string, unknown> | null;
  hasSubtotals?: boolean;
  allCols?: string[];
  bandCount?: number;
  bandIds?: string[];
  bandLabels?: Record<string, string>;
}

/**
 * A complete result set returned by the query engine.
 * @property columns - Column names in display order
 * @property rows - Array of row objects keyed by column name
 * @property metadata - Result metadata (row count, timestamp, aggregation mode, etc.)
 */
export interface ResultSet {
  columns: string[];
  rows: Record<string, unknown>[];
  metadata: ResultSetMetadata;
}

// ── Builder ────────────────────────────────────────────────────────────────────

/**
 * Build a {@link ResultSet} from raw columns, rows, and optional metadata overrides.
 *
 * Defensive: coerces non-array inputs to empty arrays and merges caller-provided
 * metadata on top of sensible defaults (rowCount from rows length, current timestamp,
 * aggMode `'none'`, displayCols `null`).
 *
 * @param columns - Column names in display order
 * @param rows - Array of row objects keyed by column name
 * @param metadata - Optional partial metadata to merge over defaults
 * @returns A fully-populated {@link ResultSet}
 */
export function buildResultSet(
  columns: string[],
  rows: Record<string, unknown>[],
  metadata?: Partial<ResultSetMetadata>,
): ResultSet {
  const r = Array.isArray(rows) ? rows : [];
  return {
    columns: Array.isArray(columns) ? columns : [],
    rows: r,
    metadata: Object.assign(
      {
        rowCount: r.length,
        generatedAt: Date.now(),
        aggMode: 'none',
        displayCols: [],
      },
      metadata || {},
    ),
  };
}
