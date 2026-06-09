import { detectDateFormat, getColumnSamples, normalizeDateExpr, type DateFormat } from '../core/date-format.js';

export function renderAggregateExpr(fn: string, colRef: string, tid?: string, col?: string): string {
  const dateFns = new Set(['DATE RANGE', 'DATE SPAN']);
  let ref = colRef;
  if (dateFns.has(fn) && tid && col) {
    const samples = getColumnSamples(tid, col);
    const format = detectDateFormat(samples);
    ref = normalizeDateExpr(colRef, format);
  }

  switch (fn) {
    case 'SUM':             return `SUM(${colRef})`;
    case 'AVG':             return `AVG(${colRef})`;
    case 'MIN':             return `MIN(${colRef})`;
    case 'MAX':             return `MAX(${colRef})`;
    case 'COUNT ROWS':      return 'COUNT(*)';
    case 'COUNT NON-EMPTY': return `COUNT(${colRef})`;
    case 'COUNT DISTINCT':  return `COUNT(DISTINCT ${colRef})`;
    case 'FIRST':           return `MIN(${colRef})`;
    case 'LAST':            return `MAX(${colRef})`;
    case 'DATE RANGE':      return `MIN(${ref}) || ' \u2014 ' || MAX(${ref})`;
    case 'DATE SPAN':       return `CAST(julianday(MAX(${ref})) - julianday(MIN(${ref})) AS INTEGER)`;
    case 'NUMERIC RANGE':   return `MIN(${colRef}) || ' \u2013 ' || MAX(${colRef})`;
    case 'NUMERIC SPAN':    return `MAX(${colRef}) - MIN(${colRef})`;
    case 'LIST':            return `GROUP_CONCAT(DISTINCT ${colRef})`;
    default:                return `COUNT(${colRef})`;
  }
}
