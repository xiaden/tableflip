import { db } from '../core/state.js';
import { quoteId } from '../core/sqldb.js';
import { ColMapEntry } from '../catalog/column-catalog.js';
import { QueryPlan } from './query-plan.js';

const _toNum = (expr: string): string =>
  `CAST(COALESCE(NULLIF(TRIM(CAST(${expr} AS TEXT)), ''), '0') AS REAL)`;

export function _renderCalcExpr(alias: string, colMap: Map<string, ColMapEntry>, plan: QueryPlan, baseTid: string, _trail?: Set<string>): string {
  if (!_trail) _trail = new Set();
  if (_trail.has(alias)) return 'NULL';

  const s = colMap.get(alias);
  if (!s) return quoteId(alias);

  if (s.kind !== 'calc') {
    const tid = s.tid === plan.source.base ? baseTid : s.tid;
    return `${tid === '_base' ? '_base' : quoteId(tid)}.${quoteId(s.col)}`;
  }

  const trail = new Set(_trail);
  trail.add(alias);

  const calc = (s.calc as CalcStage | undefined) || (db.calcStages || [])[s.idx];
  if (!calc) throw new Error(`Cannot render calc "${alias}": calc config not found`);

  if (s.mode === 'math') {
    return _renderModeMath(calc, alias, colMap, plan, baseTid, trail);
  }
  if (s.mode === 'compare') {
    return _renderModeCompare(calc, alias, colMap, plan, baseTid, trail);
  }
  if (s.mode === 'text') {
    return _renderModeText(calc, alias, colMap, plan, baseTid, trail);
  }
  if (s.mode === 'date') {
    return _renderModeDate(calc, alias, colMap, plan, baseTid, trail);
  }
  throw new Error(`Unknown calc mode "${s.mode}" for "${alias}"`);
}

// ── Mode-based calc rendering helpers ─────────────────────────────────────────

interface CalcModeMath {
  strategy?: string;
  steps: Array<{ type?: string; value?: string; op?: string }>;
}

interface CalcModeCompare {
  compareMode?: string;
  conditions: Array<{ col: string; op: string; val: string }>;
  trueValue: { type: string; value: string };
  falseValue: { type: string; value: string };
}

interface CalcModeText {
  operation: string;
  parts?: Array<{ type: string; value: string }>;
  source?: { type: string; value: string };
  count?: number;
  start?: number;
  length?: number;
}

function _renderModeMath(calc: CalcStage, alias: string, colMap: Map<string, ColMapEntry>, plan: QueryPlan, baseTid: string, trail: Set<string>): string {
  const math  = calc.math as CalcModeMath | undefined;
  const steps = math!.steps;
  const toNum = _toNum;

  const renderStepVal = (step: { type?: string; value?: string; op?: string }, t: Set<string>): string => {
    if (step.type === 'number') {
      const n = parseFloat(step.value || '');
      return Number.isFinite(n) ? String(n) : '0';
    }
    if (step.type === 'column') {
      const expr = _renderCalcExpr(step.value || '', colMap, plan, baseTid, t);
      return toNum(expr);
    }
    throw new Error(`Unsupported math step type "${step.type}" in calc "${alias}"`);
  };

  const mathOp = (calc as Record<string, unknown>).mathOp as string | undefined;
  const colExpr = renderStepVal(steps[0], trail);
  const rownoRef = baseTid === '_base' ? '"_base"."_rowno"' : `${quoteId(baseTid)}."_rowno"`;

  if (mathOp === 'ROLLAVG') {
    const window = Math.max(1, parseInt(String((calc as Record<string, unknown>).window || '7'), 10) || 7);
    return `AVG(${colExpr}) OVER (ORDER BY ${rownoRef} ROWS BETWEEN ${window - 1} PRECEDING AND CURRENT ROW)`;
  }

  if (mathOp === 'PCTTOTAL') {
    return `${colExpr} * 100.0 / NULLIF(SUM(${colExpr}) OVER (), 0)`;
  }

  let expr = colExpr;
  for (let i = 1; i < steps.length; i++) {
    const step = steps[i];
    const r    = renderStepVal(step, trail);
    switch (step.op) {
      case '+': expr = `(${expr} + ${r})`; break;
      case '-': expr = `(${expr} - ${r})`; break;
      case '*': expr = `(${expr} * ${r})`; break;
      case '/': expr = `(CASE WHEN ${r} = 0 THEN NULL ELSE ${expr} / ${r} END)`; break;
      case '%': expr = `(CASE WHEN ${r} = 0 THEN NULL ELSE ${expr} % ${r} END)`; break;
      default: throw new Error(`Unsupported math operator "${step.op}" in calc "${alias}"`);
    }
  }
  return expr;
}

function _renderModeCompare(calc: CalcStage, alias: string, colMap: Map<string, ColMapEntry>, plan: QueryPlan, baseTid: string, trail: Set<string>): string {
  const compare = calc.compare as CalcModeCompare | undefined;
  const glue    = compare!.compareMode === 'OR' ? ' OR ' : ' AND ';
  const toNum   = _toNum;

  const condParts = compare!.conditions.map((cond: { col: string; op: string; val: string }) => {
    const colExpr = _renderCalcExpr(cond.col, colMap, plan, baseTid, trail);
    const op      = cond.op;
    if (!['=', '!=', '>', '>=', '<', '<='].includes(op)) {
      throw new Error(`Invalid comparison operator "${op}" in calc "${alias}"`);
    }
    const cv  = String(cond.val ?? '').trim();
    const n   = parseFloat(cv.replace(/,/g, ''));
    const cNum = toNum(colExpr);
    const cTxt = `CAST(${colExpr} AS TEXT)`;
    if (['>', '>=', '<', '<='].includes(op)) return `${cNum} ${op} ${Number.isFinite(n) ? n : 0}`;
    if (cv !== '' && Number.isFinite(n)) return `${cNum} ${op} ${n}`;
    return `${cTxt} ${op === '=' ? '=' : '!='} '${cv.replace(/'/g, "''")}'`;
  });

  const thenExpr = _renderTypedValue(compare!.trueValue, colMap, plan, baseTid, trail);
  const elseExpr = _renderTypedValue(compare!.falseValue, colMap, plan, baseTid, trail);
  return `(CASE WHEN ${condParts.join(glue)} THEN ${thenExpr} ELSE ${elseExpr} END)`;
}

function _renderModeText(calc: CalcStage, alias: string, colMap: Map<string, ColMapEntry>, plan: QueryPlan, baseTid: string, trail: Set<string>): string {
  const text = calc.text as CalcModeText | undefined;
  const op   = text!.operation;

  if (op === 'combine') {
    const parts = text!.parts!.map((p: { type: string; value: string }) => _renderTextPart(p, colMap, plan, baseTid, trail));
    return parts.join(' || ');
  }
  if (op === 'left') {
    const src = _renderTextSource(text!.source!, colMap, plan, baseTid, trail);
    return `SUBSTR(${src}, 1, ${text!.count})`;
  }
  if (op === 'right') {
    const src = _renderTextSource(text!.source!, colMap, plan, baseTid, trail);
    return `SUBSTR(${src}, -${text!.count})`;
  }
  if (op === 'substring') {
    const src = _renderTextSource(text!.source!, colMap, plan, baseTid, trail);
    return `SUBSTR(${src}, ${text!.start}, ${text!.length})`;
  }
  throw new Error(`Unknown text operation "${op}" in calc "${alias}"`);
}

interface CalcModeDate {
  operation: string;
  source?: { type: string; value: string };
  part?: string;
  output?: string;
}

function _renderModeDate(calc: CalcStage, alias: string, colMap: Map<string, ColMapEntry>, plan: QueryPlan, baseTid: string, trail: Set<string>): string {
  const date = calc.date as CalcModeDate | undefined;
  const op   = date!.operation;

  if (op === 'extract') {
    const src = _renderDateSource(date!.source!, colMap, plan, baseTid, trail);
    const part = date!.part || 'year';
    const output = date!.output || 'text';

    const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const MONTH_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const DOW_SHORT   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const DOW_FULL    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    const monthCase = (names: string[]) => {
      const branches = names.map((n, j) => `WHEN ${j + 1} THEN '${n}'`).join(' ');
      return `(CASE CAST(strftime('%m', ${src}) AS INTEGER) ${branches} END)`;
    };

    const dowCase = (names: string[]) => {
      const branches = names.map((n, j) => `WHEN ${j} THEN '${n}'`).join(' ');
      return `(CASE CAST(strftime('%w', ${src}) AS INTEGER) ${branches} END)`;
    };

    if (part === 'quarter') {
      if (output === 'short') {
        const branches = [1,2,3,4].map(q => `WHEN ${q} THEN 'Q${q}'`).join(' ');
        return `(CASE ((CAST(strftime('%m', ${src}) AS INTEGER) - 1) / 3 + 1) ${branches} END)`;
      }
      if (output === 'text') {
        const branches = [1,2,3,4].map(q => `WHEN ${q} THEN 'Quarter ${q}'`).join(' ');
        return `(CASE ((CAST(strftime('%m', ${src}) AS INTEGER) - 1) / 3 + 1) ${branches} END)`;
      }
      return `((CAST(strftime('%m', ${src}) AS INTEGER) - 1) / 3 + 1)`;
    }

    if (part === 'julian') {
      return `CAST(julianday(${src}) AS INTEGER)`;
    }

    if (part === 'month') {
      if (output === 'short') return monthCase(MONTH_SHORT);
      if (output === 'text')  return monthCase(MONTH_FULL);
      return `CAST(strftime('%m', ${src}) AS INTEGER)`;
    }

    if (part === 'dow') {
      if (output === 'short') return dowCase(DOW_SHORT);
      if (output === 'text')  return dowCase(DOW_FULL);
      return `CAST(strftime('%w', ${src}) AS INTEGER)`;
    }

    // year, week, day — numeric only
    const partFormat: Record<string, string> = {
      'year': '%Y',
      'day': '%d',
      'week': '%W',
    };
    return `CAST(strftime('${partFormat[part]}', ${src}) AS INTEGER)`;
  }
  throw new Error(`Unknown date operation "${op}" in calc "${alias}"`);
}

function _renderDateSource(source: { type: string; value: string }, colMap: Map<string, ColMapEntry>, plan: QueryPlan, baseTid: string, trail: Set<string>): string {
  if (source.type === 'column') return _renderCalcExpr(source.value, colMap, plan, baseTid, trail);
  throw new Error(`Unsupported date source type "${source.type}"`);
}

function _renderTypedValue(tv: { type: string; value: string }, colMap: Map<string, ColMapEntry>, plan: QueryPlan, baseTid: string, trail: Set<string>): string {
  if (tv.type === 'text') return `'${String(tv.value).replace(/'/g, "''")}'`;
  if (tv.type === 'number') return String(Number(tv.value));
  if (tv.type === 'column') return _renderCalcExpr(tv.value, colMap, plan, baseTid, trail);
  throw new Error(`Unsupported typed-value type "${tv.type}"`);
}

function _renderTextPart(part: { type: string; value: string }, colMap: Map<string, ColMapEntry>, plan: QueryPlan, baseTid: string, trail: Set<string>): string {
  if (part.type === 'text') return `'${String(part.value).replace(/'/g, "''")}'`;
  if (part.type === 'number') return `CAST(${Number(part.value)} AS TEXT)`;
  if (part.type === 'column') {
    const expr = _renderCalcExpr(part.value, colMap, plan, baseTid, trail);
    return `COALESCE(CAST(${expr} AS TEXT), '')`;
  }
  throw new Error(`Unsupported text part type "${part.type}"`);
}

function _renderTextSource(source: { type: string; value: string }, colMap: Map<string, ColMapEntry>, plan: QueryPlan, baseTid: string, trail: Set<string>): string {
  if (source.type === 'text') return `'${String(source.value).replace(/'/g, "''")}'`;
  if (source.type === 'column') return _renderCalcExpr(source.value, colMap, plan, baseTid, trail);
  throw new Error(`Unsupported text source type "${source.type}"`);
}
