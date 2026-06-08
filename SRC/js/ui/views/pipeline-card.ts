import { db } from '../../core/state.js';
import { h, colUserLabel, colDisplayLabel, getTableColor, getTableColorClass, chipFgColor } from '../../core/utils.js';
import { buildColSourceMap, projectedCols, projectedColsUpToLookup, ColMapEntry } from '../../catalog/column-catalog.js';
import { _renameProjectedAliasRefs } from '../../query/alias-ref-updater.js';
import { showContextMenu } from '../components/context-menu.js';
import { renameSourceCol, resolveRenameTarget, showRenameModal } from '../components/rename-modal.js';
import { renderChip } from '../components/chip.js';
import { delegate } from '../utils/events.js';
import {
  _isSourceVisibleInLayout, _sampleTipFor, _afterCombineChange,
  _hideLookupLayoutAliasesSafely, _showLayoutAliasesForSource,
  _hideLayoutAliasesForSource, _previewOpen, _isAliasVisibleInLayout,
  _disabledCardCols,
} from '../../query/layout-selection.js';
import { _buildPreviewHTML, addStack, removeStack, removeLookup, removeCalcStage, selectAllLookupCols, selectNoneLookupCols, togglePreview, onBaseChange, addLookup, addCalcStage } from './query-builder.js';
import { getValidation } from '../../report/validation.js';
import { type CalcBuilderCtx, calcModeRenderers } from '../components/calc-builder.js';

type LookupProp = 'enabled' | 'rightId' | 'required' | 'dupMode' | 'kpLeft' | 'kpRight';
type CalcProp = 'enabled' | 'alias' | 'mode' | 'mathOp' | 'mathOperator' | 'leftCol' | 'rightCol' | 'window' | 'textSource' | 'textCount' | 'textStart' | 'textLength' | 'compareMode' | 'dateSource' | 'datePart' | 'dateOutput';
type CondProp = 'col' | 'op' | 'val';

const lookupPropHandlers: Record<LookupProp, (lk: LookupSpec, inp: HTMLInputElement, i: number, el: HTMLElement) => void> = {
  enabled: (lk, inp) => {
    const wasEnabled = lk.enabled !== false;
    const nowEnabled = inp.checked;
    lk.enabled = nowEnabled;

    if (wasEnabled && !nowEnabled) {
      const rt = lk.rightId && db.tables[lk.rightId];
      if (rt && db.selCols instanceof Set) {
        const colMap = buildColSourceMap();
        const savedAliases = new Set<string>();
        for (const col of rt.cols) {
          if (_isSourceVisibleInLayout(lk.rightId, col, colMap, db.aggMode || 'none')) {
            for (const [alias, src] of colMap.entries()) {
              if (src && src.kind !== 'calc' && src.tid === lk.rightId && src.col === col) {
                savedAliases.add(alias);
              }
            }
          }
        }
        lk._prevSelState = savedAliases;
        for (const alias of savedAliases) _disabledCardCols.add(alias);
      }
    } else if (!wasEnabled && nowEnabled) {
      const saved = lk._prevSelState as Set<string> | undefined;
      if (saved && db.selCols instanceof Set) {
        for (const alias of saved) {
          db.selCols.add(alias);
          _disabledCardCols.delete(alias);
        }
      }
      delete lk._prevSelState;
    }
  },
  rightId: (lk, inp, i) => {
    const prevRightId = lk.rightId;
    lk.rightId = inp.value;
    lk.keyPairs = [{ left: '', right: '' }];
    const rt = lk.rightId && db.tables[lk.rightId];
    lk.cols = rt ? [...rt.cols] : [];
    if (prevRightId && prevRightId !== lk.rightId) _hideLookupLayoutAliasesSafely(prevRightId, null, i);
    if (lk.rightId) _showLayoutAliasesForSource(lk.rightId);
  },
  required: (lk, inp) => {
    lk.required = inp.value === '1';
  },
  dupMode: (lk, inp) => {
    if (!lk.duplicatePolicy) lk.duplicatePolicy = { mode: 'block' };
    lk.duplicatePolicy.mode = inp.value;
  },
  kpLeft: (lk, inp) => {
    const pi = +inp.dataset.lkp!;
    if (!Array.isArray(lk.keyPairs)) lk.keyPairs = [{ left: '', right: '' }];
    if (!lk.keyPairs[pi]) lk.keyPairs[pi] = { left: '', right: '' };
    lk.keyPairs[pi].left = inp.value;
  },
  kpRight: (lk, inp) => {
    const pi = +inp.dataset.lkp!;
    if (!Array.isArray(lk.keyPairs)) lk.keyPairs = [{ left: '', right: '' }];
    if (!lk.keyPairs[pi]) lk.keyPairs[pi] = { left: '', right: '' };
    lk.keyPairs[pi].right = inp.value;
  },
};

const calcPropHandlers: Record<CalcProp, (c: CalcStage, inp: HTMLInputElement, i: number) => void> = {
  enabled: (c, inp) => {
    const wasEnabled = c.enabled !== false;
    const nowEnabled = inp.checked;
    c.enabled = nowEnabled;

    const alias = (c.alias || '').trim();
    if (!alias) return;

    if (wasEnabled && !nowEnabled) {
      if (db.selCols instanceof Set && _isAliasVisibleInLayout(alias, db.aggMode || 'none')) {
        c._prevSelState = true;
        _disabledCardCols.add(alias);
      } else {
        c._prevSelState = false;
      }
    } else if (!wasEnabled && nowEnabled) {
      if (c._prevSelState && db.selCols instanceof Set) {
        db.selCols.add(alias);
        _disabledCardCols.delete(alias);
      }
      delete c._prevSelState;
    }
  },
  alias: (c, inp) => {
    const oldAlias = (c.alias || '').trim();
    c.alias = inp.value;
    const newAlias = (c.alias || '').trim();
    _renameProjectedAliasRefs(oldAlias, newAlias);
  },
  mode: (c, inp) => {
    const newMode = inp.value as CalcMode;
    c.mode = newMode;
    delete c.math;
    delete c.compare;
    delete c.text;
    delete c.date;
    const modeDefaults: Record<CalcMode, () => unknown> = {
      math: () => ({ strategy: 'stepChain', steps: [{ type: 'column', value: '' }, { type: 'column', value: '', op: '+' }] }),
      text: () => ({ operation: 'combine', parts: [{ type: 'column', value: '' }] }),
      compare: () => ({ compareMode: 'AND', conditions: [{ col: '', op: '=', val: '' }], trueValue: { type: 'number', value: '1' }, falseValue: { type: 'number', value: '0' } }),
      date: () => ({ operation: 'extract', source: { type: 'column', value: '' }, part: 'year', output: 'number' }),
    };
    c[newMode] = modeDefaults[newMode]();
  },
  mathOp: (c, inp) => {
    const mathOp = inp.value;
    (c as Record<string, unknown>).mathOp = mathOp;
    const mathOpDefaults: Record<string, () => unknown> = {
      ARITH: () => ({ strategy: 'stepChain', steps: [{ type: 'column', value: '' }, { type: 'column', value: '', op: '+' }] }),
      ROLLAVG: () => ({ strategy: 'stepChain', steps: [{ type: 'column', value: '' }] }),
      PCTTOTAL: () => ({ strategy: 'stepChain', steps: [{ type: 'column', value: '' }] }),
    };
    c.math = mathOpDefaults[mathOp]?.();
  },
  mathOperator: (c, inp) => {
    const math = c.math as { steps?: Array<{ type?: string; value?: string; op?: string }> } | undefined;
    if (math?.steps) {
      if (math.steps.length < 2) {
        math.steps.push({ type: 'column', value: '', op: inp.value });
      } else {
        math.steps[1].op = inp.value;
      }
    }
  },
  leftCol: (c, inp) => {
    const math = c.math as { steps?: Array<{ type?: string; value?: string }> } | undefined;
    if (math?.steps && math.steps.length > 0) {
      math.steps[0] = { type: 'column', value: inp.value };
    }
  },
  rightCol: (c, inp) => {
    const math = c.math as { steps?: Array<{ type?: string; value?: string; op?: string }> } | undefined;
    if (math?.steps) {
      if (math.steps.length < 2) {
        math.steps.push({ type: 'column', value: '', op: '+' });
      }
      math.steps[1] = { ...math.steps[1], type: 'column', value: inp.value };
    }
  },
  window: (c, inp) => {
    (c as Record<string, unknown>).window = String(Math.max(1, parseInt(inp.value, 10) || 7));
  },
  textSource: (c, inp) => {
    const text = c.text as { source?: { type: string; value: string } } | undefined;
    if (text) {
      text.source = { type: 'column', value: inp.value };
    }
  },
  textCount: (c, inp) => {
    const text = c.text as { count?: number } | undefined;
    if (text) {
      text.count = Math.max(1, parseInt(inp.value, 10) || 1);
    }
  },
  textStart: (c, inp) => {
    const text = c.text as { start?: number } | undefined;
    if (text) {
      text.start = Math.max(1, parseInt(inp.value, 10) || 1);
    }
  },
  textLength: (c, inp) => {
    const text = c.text as { length?: number } | undefined;
    if (text) {
      text.length = Math.max(1, parseInt(inp.value, 10) || 1);
    }
  },
  compareMode: (c, inp) => {
    const compare = c.compare as { compareMode?: string } | undefined;
    if (compare) {
      compare.compareMode = inp.value;
    }
  },
  dateSource: (c, inp) => {
    const date = c.date as { source?: { type: string; value: string } } | undefined;
    if (date) {
      date.source = { type: 'column', value: inp.value };
    }
  },
  datePart: (c, inp) => {
    const date = c.date as { part?: string; output?: string } | undefined;
    if (date) {
      date.part = inp.value;
      if ((inp.value === 'year' || inp.value === 'week') && date.output !== 'number') {
        date.output = 'number';
      }
    }
  },
  dateOutput: (c, inp) => {
    const date = c.date as { output?: string } | undefined;
    if (date) {
      date.output = inp.value;
    }
  },
};

const condPropHandlers: Record<CondProp, (cond: { col?: string; op?: string; val?: string }, inp: HTMLInputElement) => void> = {
  col: (cond, inp) => { cond.col = inp.value; },
  op: (cond, inp) => { cond.op = inp.value; },
  val: (cond, inp) => { cond.val = inp.value; },
};

// Calc builder functions extracted to ui/components/calc-builder.ts

export function renderPipeline(ids: string[]): void {
  const pl = document.getElementById('pipeline')!;
  const sortedIds = ids.sort((a: string, b: string) => db.tables[a].name.localeCompare(db.tables[b].name));
  const usedAsLookup = new Set((db.lookups || []).map(l => l.rightId).filter(Boolean));
  const usedAsStack  = new Set(db.stacks || []);
  const layoutColMap = db.base && db.tables[db.base] ? buildColSourceMap() : new Map();
  const layoutMode = db.aggMode || 'none';

  const stackAvail  = sortedIds.filter(id => id !== db.base && !usedAsStack.has(id) && !usedAsLookup.has(id));
  const lookupAvail = sortedIds.filter(id => id !== db.base && !usedAsStack.has(id) && !usedAsLookup.has(id));

  let html = '';

  const stackSheetsHtml = db.base && db.tables[db.base] ? `
    <div class="pl-stack-sheets" id="plStackSheets">
      ${(db.stacks || []).filter(id => db.tables[id]).map(id => `
        <span class="pl-stack-chip" style="border-left:3px solid ${getTableColor(id)}">
          ${h(db.tables[id].name)}
          <span class="rm" data-rmstack="${id}">\u00D7</span>
        </span>`).join('')}
      ${stackAvail.length ? `
        <div class="pl-add-btn" id="plStackAddBtn">\uFF0B Include</div>
        <select class="pl-add-select" id="plStackSel" onchange="addStack(this.value)">
          <option value="">pick a sheet\u2026</option>
          ${stackAvail.map(id => `<option value="${id}">${h(db.tables[id].name)}</option>`).join('')}
        </select>` : ''}
    </div>` : '<span style="font-size:0.76rem;color:var(--muted)">\u2190 Pick a sheet first</span>';

  const baseColChipsHtml = db.base && db.tables[db.base] ? (() => {
    const allCols   = db.tables[db.base].cols;
    return `<div class="pl-lookup-cols" style="margin-top:6px">
      <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Columns:</span>
      <span class="tip" data-tip="Right-click any chip to rename it.">?</span>
      ${allCols.map(c => {
        const isLayoutVisible = _isSourceVisibleInLayout(db.base, c, layoutColMap, layoutMode);
        const color     = getTableColor(db.base);
        const chipStyle = `background:${color};border-color:${color};color:${chipFgColor(color)}`;
        return renderChip({ col: c, label: colUserLabel(db.base, c), selected: true, draggable: false,
          chipClass: 'pl-col-chip', className: isLayoutVisible ? '' : 'pl-col-chip-layout-hidden',
          tooltip: _sampleTipFor(db.base, c, ['Click to show/hide this column in the report layout.']),
          dataAttrs: { 'data-bcc': c }, inlineStyle: chipStyle });
      }).join('')}
      <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0" data-bc-all="1">All</button>
      <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0" data-bc-none="1">None</button>
    </div>`;
  })() : '';

  html += `<div class="pl-top-pair">
    <div class="pl-stage">
      <div class="pl-stage-label">Start from</div>
      <div class="pl-base-row">
        <select id="baseSelect" onchange="onBaseChange(this.value)">
          <option value="">\u2014 select a sheet \u2014</option>
          ${sortedIds.map(id => `<option value="${id}" ${db.base === id ? 'selected' : ''}>${h(db.tables[id].name)}</option>`).join('')}
        </select>
      </div>
      ${baseColChipsHtml}
    </div>
    <div class="pl-h-arrow"><div class="pl-h-line"></div><div class="pl-h-head"></div></div>
    <div class="pl-stage">
      <div class="pl-stage-label">Include rows from <span class="tip" data-tip="Add sheets with the same columns to get more rows. Like stacking spreadsheets on top of each other.">?</span></div>
      ${stackSheetsHtml}
    </div>
  </div>`;

  if (!db.base || !db.tables[db.base]) { pl.innerHTML = html; return; }

  html += _plArrow('base');

  (db.lookups || []).forEach((lk, i) => {
    html += _plLookupStage(lk, i, sortedIds, usedAsLookup, usedAsStack, layoutColMap, layoutMode);
    html += _plArrow(`lk${i}`);
  });

  (db.calcStages || []).forEach((calc, i) => {
    html += _plCalcStage(calc, i);
    html += _plArrow(`calc${i}`);
  });

  html += `<div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;padding:2px 0 8px">
    <div class="pl-add-btn" onclick="addLookup()">\uFF0B Look up columns from another sheet</div>
    <div class="pl-add-btn" onclick="addCalcStage()">\uFF0B Add a calculated column from existing sheets</div>
  </div>`;

  pl.innerHTML = html;

  const qs = (sel: string): NodeListOf<HTMLElement> => pl.querySelectorAll(sel) as NodeListOf<HTMLElement>;

  const addBtn = pl.querySelector('#plStackAddBtn') as HTMLElement | null;
  const addSel = pl.querySelector('#plStackSel') as HTMLElement | null;
  if (addBtn && addSel) {
    addBtn.addEventListener('click', () => {
      addSel.style.cssText = 'position:absolute;opacity:1;pointer-events:auto;width:auto;height:auto';
      const r = addBtn.getBoundingClientRect();
      addSel.style.top  = (r.bottom + window.scrollY + 2) + 'px';
      addSel.style.left = r.left + 'px';
      document.body.appendChild(addSel);
      addSel.focus();
      addSel.addEventListener('blur', () => {
        addSel.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:0;height:0';
        pl.querySelector('#plStackSheets')?.appendChild(addSel);
      }, { once: true });
    });
  }

  qs('[data-rmstack]').forEach(el => {
    el.addEventListener('click', () => removeStack(el.dataset.rmstack!));
  });
  qs('[data-rmlookup]').forEach(el => {
    el.addEventListener('click', () => removeLookup(+el.dataset.rmlookup!));
  });
  qs('[data-rmcalc]').forEach(el => {
    el.addEventListener('click', () => removeCalcStage(+el.dataset.rmcalc!));
  });
  qs('[data-rmlkp]').forEach(el => {
    el.addEventListener('click', () => {
      const lk = db.lookups[+el.dataset.li!];
      if (!lk || !Array.isArray(lk.keyPairs) || lk.keyPairs.length <= 1) return;
      lk.keyPairs.splice(+el.dataset.lkp!, 1);
      _afterCombineChange();
    });
  });
  qs('[data-addlkp]').forEach(el => {
    el.addEventListener('click', () => {
      const lk = db.lookups[+el.dataset.addlkp!];
      if (!lk) return;
      if (!Array.isArray(lk.keyPairs)) lk.keyPairs = [];
      lk.keyPairs.push({ left: '', right: '' });
      _afterCombineChange();
    });
  });
  qs('[data-li]').forEach(el => {
    el.addEventListener('change', (e: Event) => {
      const t = e.target as HTMLElement;
      const i  = +t.dataset.li!;
      const lp = t.dataset.lp as LookupProp | undefined;
      if (!lp) return;
      const lk = db.lookups[i];
      const inp = t as HTMLInputElement;
      const handler = lookupPropHandlers[lp];
      if (handler) {
        handler(lk, inp, i, el);
        _afterCombineChange();
      }
    });
  });
  qs('[data-ci]').forEach(el => {
    el.addEventListener('change', (e: Event) => {
      const t = e.target as HTMLElement;
      const i  = +t.dataset.ci!;
      const cp = t.dataset.cp as CalcProp | undefined;
      if (!cp) return;
      const c = db.calcStages?.[i];
      if (!c) return;
      const inp = t as HTMLInputElement;
      const handler = calcPropHandlers[cp];
      if (handler) {
        handler(c, inp, i);
        _afterCombineChange();
      }
    });
  });
  qs('[data-cond]').forEach(el => {
    el.addEventListener('change', (e: Event) => {
      const t = e.target as HTMLElement;
      const i = +t.dataset.ci!;
      const j = +t.dataset.cond!;
      const cp = t.dataset.cp as CondProp | undefined;
      if (!cp) return;
      const c = db.calcStages?.[i];
      if (!c || c.mode !== 'compare') return;
      const compare = c.compare as { conditions?: Array<{ col?: string; op?: string; val?: string }> } | undefined;
      if (!compare?.conditions?.[j]) return;
      const inp = t as HTMLInputElement;
      const handler = condPropHandlers[cp];
      if (handler) {
        handler(compare.conditions[j], inp);
        _afterCombineChange();
      }
    });
  });
  qs('[data-lcc]').forEach(el => {
    el.addEventListener('click', () => {
      const i   = +el.dataset.li!;
      const col = el.dataset.lcc!;
      const lk  = db.lookups[i];
      const colMap = buildColSourceMap();
      const isLayoutVisible = _isSourceVisibleInLayout(lk.rightId, col, colMap, db.aggMode || 'none');
      if (isLayoutVisible) _hideLookupLayoutAliasesSafely(lk.rightId, col, i);
      else _showLayoutAliasesForSource(lk.rightId, col);
      _afterCombineChange();
    });
  });
  qs('[data-bcc]').forEach(el => {
    el.addEventListener('click', () => {
      const col    = el.dataset.bcc!;
      const colMap = buildColSourceMap();
      const isLayoutVisible = _isSourceVisibleInLayout(db.base, col, colMap, db.aggMode || 'none');
      if (isLayoutVisible) _hideLayoutAliasesForSource(db.base, col);
      else _showLayoutAliasesForSource(db.base, col);
      _afterCombineChange();
    });
  });
  qs('[data-ccc]').forEach(el => {
    el.addEventListener('click', () => {
      const i = +el.dataset.ci!;
      const c = db.calcStages?.[i];
      const alias = (c?.alias || '').trim();
      if (!alias) return;
      if (!db.selCols) db.selCols = new Set(projectedCols());
      const s = db.selCols;
      if (s.has(alias)) s.delete(alias);
      else s.add(alias);
      _afterCombineChange();
    });
  });
  delegate(pl, '[data-bcc]', 'contextmenu', (el, e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Rename', action: () => renameSourceCol(db.base, el.dataset.bcc!, () => _afterCombineChange()) },
    ]);
  });
  delegate(pl, '[data-lcc]', 'contextmenu', (el, e) => {
    e.preventDefault();
    const lk = db.lookups[+el.dataset.li!];
    if (!lk?.rightId) return;
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Rename', action: () => renameSourceCol(lk.rightId, el.dataset.lcc!, () => _afterCombineChange()) },
    ]);
  });
  delegate(pl, '[data-ccc]', 'contextmenu', (el, e) => {
    e.preventDefault();
    const c = db.calcStages?.[+el.dataset.ci!];
    const alias = (c?.alias || '').trim();
    if (!alias) return;
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Rename', action: () => {
        const target = resolveRenameTarget(alias);
        if (!target) return;
        showRenameModal(target, () => _afterCombineChange());
      }},
    ]);
  });
  pl.querySelector('[data-bc-all]')?.addEventListener('click', () => {
    _showLayoutAliasesForSource(db.base);
    _afterCombineChange();
  });
  pl.querySelector('[data-bc-none]')?.addEventListener('click', () => {
    _hideLayoutAliasesForSource(db.base);
    _afterCombineChange();
  });
  qs('[data-lk-all]').forEach(el => {
    el.addEventListener('click', () => selectAllLookupCols(+el.dataset.lkAll!));
  });
  qs('[data-lk-none]').forEach(el => {
    el.addEventListener('click', () => selectNoneLookupCols(+el.dataset.lkNone!));
  });
  qs('[data-preview]').forEach(el => {
    el.addEventListener('click', () => togglePreview(el.dataset.preview!));
  });
}

function _plArrow(key: string): string {
  const isOpen = _previewOpen.has(key);
  return `<div class="pl-arrow">
    <div class="pl-arrow-line"></div>
    <div class="pl-arrow-meta">
      <button class="pl-preview-btn" data-preview="${key}">${isOpen ? '\u25B2 Hide preview' : '\u25BC Preview'}</button>
    </div>
    <div class="pl-arrow-line"></div>
    <div class="pl-arrow-head"></div>
    ${isOpen ? `<div class="pl-mini-preview" id="preview_${key}">${_buildPreviewHTML(key)}</div>` : ''}
  </div>`;
}

function _plLookupStage(lk: LookupSpec, i: number, sortedIds: string[], usedAsLookup: Set<string>, usedAsStack: Set<string>, layoutColMap: Map<string, ColMapEntry>, layoutMode: string): string {
  const rt        = lk.rightId && db.tables[lk.rightId];
  const leftCols  = projectedColsUpToLookup(i);
  const rightCols = rt ? rt.cols : [];

  if (!Array.isArray(lk.keyPairs) || !lk.keyPairs.length) lk.keyPairs = [{ left: '', right: '' }];
  const pairs = lk.keyPairs;

  const sheetOpts = sortedIds
    .filter(id => id !== db.base && (!usedAsLookup.has(id) || id === lk.rightId) && !usedAsStack.has(id))
    .map(id => `<option value="${id}" ${lk.rightId === id ? 'selected' : ''}>${h(db.tables[id].name)}</option>`)
    .join('');

  const lkColorCls = lk.rightId ? getTableColorClass(lk.rightId) : '';
  const lkColMap   = buildColSourceMap();
  const leftOptsFor  = (val: string) => leftCols.map(c =>
    `<option value="${h(c)}" ${val === c ? 'selected' : ''}>${h(colDisplayLabel(c, lkColMap))}</option>`).join('');
  const rightOptsFor = (val: string) => rightCols.map(c =>
    `<option value="${h(c)}" ${val === c ? 'selected' : ''}>${h(`${db.tables[lk.rightId]?.name || lk.rightId} \u2192 ${colUserLabel(lk.rightId, c)}`)}</option>`).join('');

  const keyPairsHTML = pairs.map((pair, pi) => `
    <div class="pl-key-pair">
      <span class="pl-key-pair-label">${pi === 0 ? 'Where' : 'AND'}</span>
      <select data-li="${i}" data-lkp="${pi}" data-lp="kpLeft">
        <option value="">\u2014 column \u2014</option>${leftOptsFor(pair.left)}
      </select>
      <span class="pl-lookup-eq">=</span>
      <select data-li="${i}" data-lkp="${pi}" data-lp="kpRight">
        <option value="">\u2014 column \u2014</option>${rightOptsFor(pair.right)}
      </select>
      ${pairs.length > 1 ? `<button class="pl-rm-kp" data-rmlkp="1" data-li="${i}" data-lkp="${pi}" title="Remove this condition">\u2715</button>` : ''}
    </div>`).join('');

  const colChips = rt ? rt.cols.map(c => {
    const isLayoutVisible = _isSourceVisibleInLayout(lk.rightId, c, layoutColMap, layoutMode);
    return renderChip({ col: c, label: colUserLabel(lk.rightId, c), selected: true, draggable: false,
      chipClass: 'pl-col-chip', colorClass: lkColorCls,
      className: isLayoutVisible ? '' : 'pl-col-chip-layout-hidden',
      tooltip: _sampleTipFor(lk.rightId, c, ['Click to show/hide this lookup column in the report layout.']),
      dataAttrs: { 'data-li': String(i), 'data-lcc': c } });
  }).join('') : '';

  const lkEnabled = lk.enabled !== false;
  const lkV = getValidation()!.items[`lookup_${i}`];
  const lkVBlocked = lkV && lkV.blocking;
  const lkVUnresolved = lkV && !lkV.resolved;
  const lkVMsg = lkVUnresolved && lkV.issues[0] ? lkV.issues[0].message : null;

  return `<div class="pl-lookup-stage${lkVBlocked ? ' pl-lookup-stage--invalid' : lkVUnresolved && !lkEnabled ? ' pl-lookup-stage--disabled-issue' : ''} ${!lkEnabled ? 'pl-stage-disabled' : ''}">
    <div class="pl-stage-label">Look up columns from <span class="tip" data-tip="Pull columns from another sheet by matching a shared value \u2014 like VLOOKUP. Use '+ AND' to match on multiple columns at once.">?</span>
      <label class="pl-enable-toggle" title="${lkEnabled ? 'Disable this lookup (won\'t block report)' : 'Enable this lookup'}"><input type="checkbox" data-li="${i}" data-lp="enabled" ${lkEnabled ? 'checked' : ''}><span class="pl-enable-label">${lkEnabled ? 'Enabled' : 'Disabled'}</span></label>
    </div>
    ${lkVMsg ? `<div class="pl-lookup-error">${lkVBlocked ? '\u26D4' : '\u26A0'} ${h(lkVMsg)}</div>` : ''}
    <div class="pl-lookup-header">
      <select data-li="${i}" data-lp="rightId">
        <option value="">\u2014 pick a sheet \u2014</option>
        ${sheetOpts}
      </select>
      <button class="btn btn-danger" style="flex-shrink:0" data-rmlookup="${i}">\u2715</button>
    </div>
    ${rt ? `
    <div class="pl-lookup-keys">
      ${keyPairsHTML}
      <button class="btn btn-ghost pl-add-kp" data-addlkp="${i}">\uFF0B AND \u2026</button>
    </div>
    <div class="pl-lookup-required">
      <span style="flex-shrink:0">If no match:</span>
      <label><input type="radio" name="lkreq_${i}" data-li="${i}" data-lp="required" value="0" ${!lk.required ? 'checked' : ''}> Leave blank</label>
      <label><input type="radio" name="lkreq_${i}" data-li="${i}" data-lp="required" value="1" ${lk.required ? 'checked' : ''}> Skip row</label>
      <span class="tip" data-tip="Leave blank: keep all rows even if no match.&#10;Skip row: only keep rows that match.">?</span>
    </div>
    <div class="pl-lookup-required">
      <span style="flex-shrink:0">Duplicate keys:</span>
      <label><input type="radio" name="lkdup_${i}" data-li="${i}" data-lp="dupMode" value="block" ${(lk.duplicatePolicy && lk.duplicatePolicy.mode) !== 'combine' ? 'checked' : ''}> Block (error)</label>
      <label><input type="radio" name="lkdup_${i}" data-li="${i}" data-lp="dupMode" value="combine" ${(lk.duplicatePolicy && lk.duplicatePolicy.mode) === 'combine' ? 'checked' : ''}> Combine values</label>
      <span class="tip" data-tip="Block: the report cannot run if the same key appears more than once in the lookup sheet.&#10;Combine: concatenate matching values into a single cell, e.g. 'Tag1; Tag2'.">?</span>
    </div>
    <div class="pl-lookup-cols">
      <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Bring in:</span>
      <span class="tip" data-tip="Right-click any chip to rename it.">?</span>
      ${colChips}
      <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0" data-lk-all="${i}">All</button>
      <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0" data-lk-none="${i}">None</button>
    </div>` : ''}
  </div>`;
}

function _plCalcStage(calc: CalcStage, i: number): string {
  const cols   = projectedCols();
  const colMap = buildColSourceMap();
  const alias  = (calc.alias || '').trim();
  const mode   = calc.mode || 'math';

  const calcEnabled = calc.enabled !== false;
  const calcV = getValidation()!.items[`calc_${i}`];
  const calcVBlocked = calcV && calcV.blocking;
  const calcVUnresolved = calcV && !calcV.resolved;
  const calcVMsg = calcVUnresolved && calcV.issues[0] ? calcV.issues[0].message : null;

  const colOptsFor = (sel: string) => cols
    .filter(c => c !== alias)
    .map(c => `<option value="${h(c)}" ${sel === c ? 'selected' : ''}>${h(colDisplayLabel(c, colMap))}</option>`)
    .join('');

  const builderCtx: CalcBuilderCtx = { calc, i, cols, colOptsFor };
  const builderHtml = calcModeRenderers[mode](builderCtx);

  return `<div class="pl-lookup-stage${calcVBlocked ? ' pl-lookup-stage--invalid' : calcVUnresolved && !calcEnabled ? ' pl-lookup-stage--disabled-issue' : ''} ${!calcEnabled ? 'pl-stage-disabled' : ''}">
    <div class="pl-stage-label">Calculated column <span class="tip" data-tip="Create a virtual column from existing columns.&#10;Math: arithmetic, rolling averages, percentages.&#10;Text: string operations.&#10;Compare: conditional logic.&#10;Date: extract date parts.">?</span>
      <label class="pl-enable-toggle" title="${calcEnabled ? 'Disable this calculated column' : 'Enable this calculated column'}"><input type="checkbox" data-ci="${i}" data-cp="enabled" ${calcEnabled ? 'checked' : ''}><span class="pl-enable-label">${calcEnabled ? 'Enabled' : 'Disabled'}</span></label>
    </div>
    ${calcVMsg ? `<div class="pl-lookup-error">${calcVBlocked ? '\u26D4' : '\u26A0'} ${h(calcVMsg)}</div>` : ''}
    <div class="pl-lookup-header" style="gap:8px;flex-wrap:wrap">
      <input type="text" data-ci="${i}" data-cp="alias" placeholder="Output column name" value="${h(calc.alias || '')}" style="flex:1;min-width:180px">
      <button class="btn btn-danger" style="flex-shrink:0" data-rmcalc="${i}">\u2715</button>
    </div>
    <div class="tab-row" style="margin-top:8px">
      <label class="tab-opt"><input type="radio" name="calcMode_${i}" value="math" ${mode === 'math' ? 'checked' : ''} data-ci="${i}" data-cp="mode"><span>Math</span></label>
      <label class="tab-opt"><input type="radio" name="calcMode_${i}" value="text" ${mode === 'text' ? 'checked' : ''} data-ci="${i}" data-cp="mode"><span>Text</span></label>
      <label class="tab-opt"><input type="radio" name="calcMode_${i}" value="compare" ${mode === 'compare' ? 'checked' : ''} data-ci="${i}" data-cp="mode"><span>Compare</span></label>
      <label class="tab-opt"><input type="radio" name="calcMode_${i}" value="date" ${mode === 'date' ? 'checked' : ''} data-ci="${i}" data-cp="mode"><span>Date</span></label>
    </div>
    ${builderHtml}
    ${alias ? `<div class="pl-lookup-cols" style="margin-top:8px">
      <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Output:</span>
      <span class="tip" data-tip="Right-click the chip to rename this column. The alias input above will update.">?</span>
      ${renderChip({ col: alias, label: colDisplayLabel(alias, colMap), selected: _isAliasVisibleInLayout(alias, db.aggMode || 'none'),
        draggable: false, chipClass: 'pl-col-chip', dataAttrs: { 'data-ci': String(i), 'data-ccc': alias } })}
    </div>` : ''}
  </div>`;
}
