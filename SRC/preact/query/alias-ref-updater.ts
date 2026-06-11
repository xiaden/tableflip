export function _renameProjectedAliasRefs(oldAlias: string, newAlias: string): void {
  const db = (typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>).__db : null) as Record<string, unknown> | null;
  if (!db) return;

  const filters = db.filters as Array<Record<string, unknown>> | undefined;
  if (filters) {
    for (const f of filters) {
      if (f.col === oldAlias) f.col = newAlias;
    }
  }

  const sorts = db.sorts as Array<Record<string, unknown>> | undefined;
  if (sorts) {
    for (const s of sorts) {
      if (s.col === oldAlias) s.col = newAlias;
    }
  }

  const groupBy = db.groupBy as string[] | undefined;
  if (groupBy) {
    for (let i = 0; i < groupBy.length; i++) {
      if (groupBy[i] === oldAlias) groupBy[i] = newAlias;
    }
  }

  const aggregates = db.aggregates as Array<Record<string, unknown>> | undefined;
  if (aggregates) {
    for (const a of aggregates) {
      if (a.col === oldAlias) a.col = newAlias;
    }
  }
}
