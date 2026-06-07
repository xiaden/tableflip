export function renderAggregateExpr(fn, colRef) {
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
    case 'DATE RANGE':      return `MIN(${colRef}) || ' \u2014 ' || MAX(${colRef})`;
    case 'DATE SPAN':       return `CAST(julianday(MAX(${colRef})) - julianday(MIN(${colRef})) AS INTEGER)`;
    case 'NUMERIC RANGE':   return `MIN(${colRef}) || ' \u2013 ' || MAX(${colRef})`;
    case 'NUMERIC SPAN':    return `MAX(${colRef}) - MIN(${colRef})`;
    case 'LIST':            return `GROUP_CONCAT(DISTINCT ${colRef})`;
    default:                return `COUNT(${colRef})`;
  }
}
