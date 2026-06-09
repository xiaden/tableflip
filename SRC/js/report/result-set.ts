export interface ResultSetMetadata {
  rowCount: number;
  generatedAt: number;
  aggMode: string;
  displayCols: string[] | null;
  totalsRow?: Record<string, unknown> | null;
  hasSubtotals?: boolean;
  allCols?: string[];
}

export interface ResultSet {
  columns: string[];
  rows: Record<string, unknown>[];
  metadata: ResultSetMetadata;
}

export function buildResultSet(columns: string[], rows: Record<string, unknown>[], metadata?: Partial<ResultSetMetadata>): ResultSet {
  const r = Array.isArray(rows) ? rows : [];
  return {
    columns:  Array.isArray(columns) ? columns : [],
    rows:     r,
    metadata: Object.assign({
      rowCount:    r.length,
      generatedAt: Date.now(),
      aggMode:     'none',
      displayCols: null,
    }, metadata || {}),
  };
}
