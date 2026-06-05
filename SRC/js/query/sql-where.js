'use strict';

function renderWhereClause(colRef, op, val, params, opts) {
  const likeEsc      = v => v.replace(/%/g, '\\%').replace(/_/g, '\\_');
  const txt          = `CAST(${colRef} AS TEXT)`;
  const num          = `CAST(${colRef} AS REAL)`;
  const numericHint  = !!(opts && opts.numericHint);
  const normVal      = String(val ?? '').trim();
  const numVal       = Number(normVal.replace(/,/g, ''));
  const hasNumericVal = normVal !== '' && Number.isFinite(numVal);

  switch (op) {
    case 'contains':
      params.push('%' + likeEsc(val) + '%');
      return `${txt} LIKE ? ESCAPE '\\'`;
    case 'equals':
      if (numericHint && hasNumericVal) { params.push(numVal); return `${num} = ?`; }
      params.push(val); return `${txt} = ?`;
    case 'not equals':
      if (numericHint && hasNumericVal) { params.push(numVal); return `${num} != ?`; }
      params.push(val); return `${txt} != ?`;
    case '>':   params.push(+val || 0); return `${num} > ?`;
    case '<':   params.push(+val || 0); return `${num} < ?`;
    case '>=':  params.push(+val || 0); return `${num} >= ?`;
    case '<=':  params.push(+val || 0); return `${num} <= ?`;
    case 'starts with': params.push(likeEsc(val) + '%'); return `${txt} LIKE ? ESCAPE '\\'`;
    case 'ends with':   params.push('%' + likeEsc(val)); return `${txt} LIKE ? ESCAPE '\\'`;
    case 'is empty':  return `(${colRef} IS NULL OR ${txt} = '')`;
    case 'not empty': return `(${colRef} IS NOT NULL AND ${txt} != '')`;
    default: return null;
  }
}

const buildWhere = renderWhereClause;
