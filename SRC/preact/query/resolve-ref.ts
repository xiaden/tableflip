/**
 * Shared column alias → SQL reference resolution.
 *
 * Physical columns are quoted as "tid"."col" via quoteId().
 * Calc columns are quoted by their alias.
 */

import type { ColMapEntry } from '../catalog/column-catalog';
import { quoteId } from '../core/sqldb';

/**
 * Resolve a column alias to a SQL column reference expression.
 * Physical columns use the "tid"."col" format; calc and band columns use the quoted alias.
 * Band columns are not resolved to physical references because they have no JOIN
 * in the main query's FROM clause — they are only used by band-specific queries.
 */
export function resolveRef(alias: string, colMap: Map<string, ColMapEntry>): string {
  const entry = colMap.get(alias);
  if (!entry || entry.kind === 'calc' || entry.kind === 'band') return quoteId(alias);
  return `${quoteId(entry.tid)}.${quoteId(entry.col)}`;
}