import { db } from './state.js';
import { toast, dl } from './utils.js';
import { STATE_VERSION } from './state-schema.js';
import { saveActiveAggModeState, ensureAggModeState } from '../ui/aggregation.js';

export function saveState() {
  if (!db.base) { toast('Nothing to save \u2014 load a data file first.', 'err'); return; }
  if (typeof saveActiveAggModeState === 'function') saveActiveAggModeState();
  if (typeof ensureAggModeState === 'function') ensureAggModeState();

  const raw = window.prompt('Save query as:', 'my-query');
  if (raw === null) return;
  const name = (raw.trim() || 'my-query').replace(/\.rcjson$/i, '');

  const excludedRowsSerial = {};
  for (const [tid, set] of Object.entries(db.excludedRows)) {
    if (set && set.size) excludedRowsSerial[tid] = [...set];
  }

  const payload = {
    v:            STATE_VERSION,
    base:         db.base,
    baseCols:     db.baseCols ? [...db.baseCols] : null,
    stacks:       [...(db.stacks || [])],
    lookups:      (db.lookups || []).map(l => ({
      rightId:  l.rightId,
      keyPairs: (l.keyPairs || []).map(p => ({ left: p.left, right: p.right })),
      cols:     [...(l.cols || [])],
      required: !!l.required,
      enabled:  l.enabled !== false,
      duplicatePolicy: l.duplicatePolicy ? { ...l.duplicatePolicy } : { mode: 'block' },
    })),
    calcStages:   (db.calcStages || []).map(c => {
      if (c.mode) {
        return {
          alias: (c.alias || '').trim(),
          mode: c.mode,
          enabled: c.enabled !== false,
          ...(c.math ? { math: JSON.parse(JSON.stringify(c.math)) } : {}),
          ...(c.compare ? { compare: JSON.parse(JSON.stringify(c.compare)) } : {}),
          ...(c.text ? { text: JSON.parse(JSON.stringify(c.text)) } : {}),
        };
      }
      return {
        alias: (c.alias || '').trim(),
        left:  c.left || '',
        op:    c.op || '-',
        right: c.right || '',
        conditions: (c.conditions || []).map(cond => ({
          col: cond.col || '',
          op:  cond.op  || '=',
          val: cond.val ?? '',
        })),
        compareMode: c.compareMode === 'OR' ? 'OR' : 'AND',
        window: Math.max(1, parseInt(c.window, 10) || 7),
        explicitOrder: !!c.explicitOrder,
        orderCol: c.orderCol || '',
        orderDir: c.orderDir === 'DESC' ? 'DESC' : 'ASC',
        enabled:  c.enabled !== false,
      };
    }),
    selCols:      db.selCols ? [...db.selCols] : null,
    colOrder:     db.colOrder ? [...db.colOrder] : null,
    filters:      db.filters.map(f => ({
      col:     f.col  || '',
      op:      f.op   || 'contains',
      vals:    Array.isArray(f.vals) ? [...f.vals] : [''],
      enabled: f.enabled !== false,
    })),
    sorts:        db.sorts.map(s => ({ col: s.col || '', dir: s.dir === 'DESC' ? 'DESC' : 'ASC', enabled: s.enabled !== false })),
    groupBy:      [...db.groupBy],
    aggregates:   db.aggregates.map(a => ({ ...a })),
    aggMode:            db.aggMode || 'none',
    aggModeState:       JSON.parse(JSON.stringify(db.aggModeState || {})),
    colTotals:          { ...(db.colTotals || {}) },
    subtotalBy:         [...(db.subtotalBy || [])],
    subtotalFns:        { ...(db.subtotalFns || {}) },
    subtotalGrandTotal: db.subtotalGrandTotal !== false,
    subtotalSpacer:     !!db.subtotalSpacer,
    subtotalOnTop:      !!db.subtotalOnTop,
    subtotalStrategy:   db.subtotalStrategy || 'combined',
    mergedCols:         [...(db.mergedCols || [])],
    mergeGroupUnderline: !!db.mergeGroupUnderline,
    colState:           db.colState || null,
    excludedRows: excludedRowsSerial,
    tableColors:  { ...(db.tableColors || {}) },
    columnLabels: JSON.parse(JSON.stringify(db.columnLabels || {})),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  dl(blob, name + '.rcjson');
}

window.saveState = saveState;
