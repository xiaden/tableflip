import { render } from 'preact/compat';
import { useState } from 'preact/hooks';
import { db } from '../../core/state.js';
import { colUserLabel, colDisplayLabel, getTableColor, getTableColorClass, chipFgColor } from '../../core/utils.js';
import { buildColSourceMap, projectedCols, projectedColsUpToLookup, type ColMapEntry } from '../../catalog/column-catalog.js';
import { _renameProjectedAliasRefs } from '../../query/alias-ref-updater.js';
import { ContextMenu } from '../components/context-menu.js';
import { resolveRenameTarget, RenameModal, type RenameTarget } from '../components/rename-modal.js';
import { Chip } from '../components/chip.js';
import { Tip } from '../components/tip.js';
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

const lookupPropHandlers: Record<LookupProp, (lk: LookupSpec, inp: HTMLInputElement, i: number, el?: HTMLElement) => void> = {
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
    const pi = +(inp.dataset.lkp ?? '0');
    if (!Array.isArray(lk.keyPairs)) lk.keyPairs = [{ left: '', right: '' }];
    if (!lk.keyPairs[pi]) lk.keyPairs[pi] = { left: '', right: '' };
    lk.keyPairs[pi].left = inp.value;
  },
  kpRight: (lk, inp) => {
    const pi = +(inp.dataset.lkp ?? '0');
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

// ── Preact Sub-Components ──

function StackSheets({ sortedIds, usedAsLookup, usedAsStack }: { sortedIds: string[]; usedAsLookup: Set<string>; usedAsStack: Set<string> }) {
  if (!db.base || !db.tables[db.base]) {
    return <span style="font-size:0.76rem;color:var(--muted)">{'\u2190'} Pick a sheet first</span>;
  }

  const stackAvail = sortedIds.filter(id => id !== db.base && !usedAsStack.has(id) && !usedAsLookup.has(id));

  return (
    <div class="pl-stack-sheets">
      {(db.stacks || []).filter(id => db.tables[id]).map(id => (
        <span class="pl-stack-chip" style={`border-left:3px solid ${getTableColor(id)}`}>
          {db.tables[id].name}
          <span class="rm" onClick={() => removeStack(id)}>{'\u00D7'}</span>
        </span>
      ))}
      {stackAvail.length > 0 && (
        <select style="position:absolute;opacity:0;pointer-events:none;width:0;height:0"
          onChange={(e) => { addStack((e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ''; }}>
          <option value="">pick a sheet{'\u2026'}</option>
          {stackAvail.map(id => <option value={id}>{db.tables[id].name}</option>)}
        </select>
      )}
      {stackAvail.length > 0 && (
        <div class="pl-add-btn" onClick={(e) => {
          const btn = e.currentTarget as HTMLElement;
          const sel = btn.nextElementSibling as HTMLSelectElement;
          if (!sel) return;
          sel.style.cssText = 'position:absolute;opacity:1;pointer-events:auto;width:auto;height:auto';
          const r = btn.getBoundingClientRect();
          sel.style.top = (r.bottom + window.scrollY + 2) + 'px';
          sel.style.left = r.left + 'px';
          document.body.appendChild(sel);
          sel.focus();
          sel.addEventListener('blur', () => {
            sel.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:0;height:0';
            btn.parentElement?.appendChild(sel);
          }, { once: true });
        }}>{'\uFF0B'} Include</div>
      )}
    </div>
  );
}

function BaseStage({ sortedIds, usedAsLookup, usedAsStack, layoutColMap, layoutMode }: { sortedIds: string[]; usedAsLookup: Set<string>; usedAsStack: Set<string>; layoutColMap: Map<string, ColMapEntry>; layoutMode: string }) {
  const allCols = db.base && db.tables[db.base] ? db.tables[db.base].cols : [];
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: { label: string; action: () => void }[] } | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  return (
    <>
    <div class="pl-top-pair">
      <div class="pl-stage">
        <div class="pl-stage-label">Start from</div>
        <div class="pl-base-row">
          <select value={db.base || ''} onChange={(e) => onBaseChange((e.target as HTMLSelectElement).value)}>
            <option value="">{'\u2014'} select a sheet {'\u2014'}</option>
            {sortedIds.map(id => <option value={id}>{db.tables[id].name}</option>)}
          </select>
        </div>
        {db.base && db.tables[db.base] && (
          <div class="pl-lookup-cols" style="margin-top:6px">
            <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Columns:</span>
            <Tip text="Right-click any chip to rename it." />
            {allCols.map(c => {
              const isLayoutVisible = _isSourceVisibleInLayout(db.base, c, layoutColMap, layoutMode);
              const color = getTableColor(db.base);
              const chipStyle = `background:${color};border-color:${color};color:${chipFgColor(color)}`;
              return (
                <Chip
                  col={c}
                  label={colUserLabel(db.base, c)}
                  selected={true}
                  draggable={false}
                  chipClass="pl-col-chip"
                  className={isLayoutVisible ? '' : 'pl-col-chip-layout-hidden'}
                  tooltip={_sampleTipFor(db.base, c, ['Click to show/hide this column in the report layout.'])}
                  dataAttrs={{ 'data-bcc': c }}
                  inlineStyle={chipStyle}
                  onClick={() => {
                    const colMap = buildColSourceMap();
                    const visible = _isSourceVisibleInLayout(db.base, c, colMap, db.aggMode || 'none');
                    if (visible) _hideLayoutAliasesForSource(db.base, c);
                    else _showLayoutAliasesForSource(db.base, c);
                    _afterCombineChange();
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const colMap = buildColSourceMap();
                    let alias = '';
                    for (const [a, src] of colMap.entries()) {
                      if (src && src.kind !== 'calc' && src.tid === db.base && src.col === c) { alias = a; break; }
                    }
                    if (!alias) return;
                    setCtxMenu({
                      x: e.clientX, y: e.clientY,
                      items: [{ label: 'Rename', action: () => setRenameTarget(resolveRenameTarget(alias)) }],
                    });
                  }}
                />
              );
            })}
            <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0"
              onClick={() => { _showLayoutAliasesForSource(db.base); _afterCombineChange(); }}>All</button>
            <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0"
              onClick={() => { _hideLayoutAliasesForSource(db.base); _afterCombineChange(); }}>None</button>
          </div>
        )}
      </div>
      <div class="pl-h-arrow"><div class="pl-h-line"></div><div class="pl-h-head"></div></div>
      <div class="pl-stage">
        <div class="pl-stage-label">Include rows from <Tip text="Add sheets with the same columns to get more rows. Like stacking spreadsheets on top of each other." /></div>
        <StackSheets sortedIds={sortedIds} usedAsLookup={usedAsLookup} usedAsStack={usedAsStack} />
      </div>
    </div>
    {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
    {renameTarget && <RenameModal target={renameTarget} onDone={() => _afterCombineChange()} onClose={() => setRenameTarget(null)} />}
    </>
  );
}

function PipelineArrow({ id }: { id: string }) {
  const isOpen = _previewOpen.has(id);
  return (
    <div class="pl-arrow">
      <div class="pl-arrow-line"></div>
      <div class="pl-arrow-meta">
        <button class="pl-preview-btn" onClick={() => togglePreview(id)}>
          {isOpen ? '\u25B2 Hide preview' : '\u25BC Preview'}
        </button>
      </div>
      <div class="pl-arrow-line"></div>
      <div class="pl-arrow-head"></div>
      {isOpen && <div class="pl-mini-preview" dangerouslySetInnerHTML={{ __html: _buildPreviewHTML(id) }}></div>}
    </div>
  );
}

function LookupStage({ lk, i, sortedIds, usedAsLookup, usedAsStack, layoutColMap, layoutMode }: {
  lk: LookupSpec; i: number; sortedIds: string[]; usedAsLookup: Set<string>; usedAsStack: Set<string>;
  layoutColMap: Map<string, ColMapEntry>; layoutMode: string;
}) {
  const rt = lk.rightId && db.tables[lk.rightId];
  const leftCols = projectedColsUpToLookup(i);
  const rightCols = rt ? rt.cols : [];

  if (!Array.isArray(lk.keyPairs) || !lk.keyPairs.length) lk.keyPairs = [{ left: '', right: '' }];
  const pairs = lk.keyPairs;

  const lkColorCls = lk.rightId ? getTableColorClass(lk.rightId) : '';
  const lkColMap = buildColSourceMap();

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: { label: string; action: () => void }[] } | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  const lkEnabled = lk.enabled !== false;
  const lkV = getValidation()!.items[`lookup_${i}`];
  const lkVBlocked = lkV && lkV.blocking;
  const lkVUnresolved = lkV && !lkV.resolved;
  const lkVMsg = lkVUnresolved && lkV.issues[0] ? lkV.issues[0].message : null;

  const stageClasses = [
    'pl-lookup-stage',
    lkVBlocked ? 'pl-lookup-stage--invalid' : '',
    lkVUnresolved && !lkEnabled ? 'pl-lookup-stage--disabled-issue' : '',
    !lkEnabled ? 'pl-stage-disabled' : '',
  ].filter(Boolean).join(' ');

  const handleLookupChange = (prop: LookupProp, e: Event) => {
    const inp = e.target as HTMLInputElement;
    const handler = lookupPropHandlers[prop];
    if (handler) {
      handler(lk, inp, i);
      _afterCombineChange();
    }
  };

  return (
    <>
    <div class={stageClasses}>
      <div class="pl-stage-label">Look up columns from <Tip text={"Pull columns from another sheet by matching a shared value \u2014 like VLOOKUP. Use '+ AND' to match on multiple columns at once."} />
        <label class="pl-enable-toggle" title={lkEnabled ? "Disable this lookup (won't block report)" : 'Enable this lookup'}>
          <input type="checkbox" checked={lkEnabled} onChange={(e) => handleLookupChange('enabled', e)} />
          <span class="pl-enable-label">{lkEnabled ? 'Enabled' : 'Disabled'}</span>
        </label>
      </div>
      {lkVMsg && <div class="pl-lookup-error">{lkVBlocked ? '\u26D4' : '\u26A0'} {lkVMsg}</div>}
      <div class="pl-lookup-header">
        <select value={lk.rightId || ''} onChange={(e) => handleLookupChange('rightId', e)}>
          <option value="">{'\u2014'} pick a sheet {'\u2014'}</option>
          {sortedIds
            .filter(id => id !== db.base && (!usedAsLookup.has(id) || id === lk.rightId) && !usedAsStack.has(id))
            .map(id => <option value={id}>{db.tables[id].name}</option>)}
        </select>
        <button class="btn btn-danger" style="flex-shrink:0" onClick={() => removeLookup(i)}>{'\u2715'}</button>
      </div>
      {rt && (
        <div class="pl-lookup-keys">
          {pairs.map((pair, pi) => (
            <div class="pl-key-pair">
              <span class="pl-key-pair-label">{pi === 0 ? 'Where' : 'AND'}</span>
              <select value={pair.left || ''} data-lkp={String(pi)} onChange={(e) => handleLookupChange('kpLeft', e)}>
                <option value="">{'\u2014'} column {'\u2014'}</option>
                {leftCols.map(c => <option value={c}>{colDisplayLabel(c, lkColMap)}</option>)}
              </select>
              <span class="pl-lookup-eq">=</span>
              <select value={pair.right || ''} data-lkp={String(pi)} onChange={(e) => handleLookupChange('kpRight', e)}>
                <option value="">{'\u2014'} column {'\u2014'}</option>
                {rightCols.map(c => <option value={c}>{`${db.tables[lk.rightId]?.name || lk.rightId} \u2192 ${colUserLabel(lk.rightId, c)}`}</option>)}
              </select>
              {pairs.length > 1 && (
                <button class="pl-rm-kp" title="Remove this condition" onClick={() => {
                  lk.keyPairs.splice(pi, 1);
                  _afterCombineChange();
                }}>{'\u2715'}</button>
              )}
            </div>
          ))}
          <button class="btn btn-ghost pl-add-kp" onClick={() => {
            if (!Array.isArray(lk.keyPairs)) lk.keyPairs = [];
            lk.keyPairs.push({ left: '', right: '' });
            _afterCombineChange();
          }}>{'\uFF0B'} AND {'\u2026'}</button>
        </div>
      )}
      {rt && (
        <div class="pl-lookup-required">
          <span style="flex-shrink:0">If no match:</span>
          <label><input type="radio" name={`lkreq_${i}`} value="0" checked={!lk.required} onChange={(e) => handleLookupChange('required', e)} /> Leave blank</label>
          <label><input type="radio" name={`lkreq_${i}`} value="1" checked={lk.required} onChange={(e) => handleLookupChange('required', e)} /> Skip row</label>
          <Tip text="Leave blank: keep all rows even if no match.\nSkip row: only keep rows that match." />
        </div>
      )}
      {rt && (
        <div class="pl-lookup-required">
          <span style="flex-shrink:0">Duplicate keys:</span>
          <label><input type="radio" name={`lkdup_${i}`} value="block" checked={(lk.duplicatePolicy && lk.duplicatePolicy.mode) !== 'combine'} onChange={(e) => handleLookupChange('dupMode', e)} /> Block (error)</label>
          <label><input type="radio" name={`lkdup_${i}`} value="combine" checked={(lk.duplicatePolicy && lk.duplicatePolicy.mode) === 'combine'} onChange={(e) => handleLookupChange('dupMode', e)} /> Combine values</label>
          <Tip text={"Block: the report cannot run if the same key appears more than once in the lookup sheet.\nCombine: concatenate matching values into a single cell, e.g. 'Tag1; Tag2'."} />
        </div>
      )}
      {rt && (
        <div class="pl-lookup-cols">
          <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Bring in:</span>
          <Tip text="Right-click any chip to rename it." />
          {rt.cols.map(c => {
            const isLayoutVisible = _isSourceVisibleInLayout(lk.rightId, c, layoutColMap, layoutMode);
            return (
              <Chip
                col={c}
                label={colUserLabel(lk.rightId, c)}
                selected={true}
                draggable={false}
                chipClass="pl-col-chip"
                colorClass={lkColorCls}
                className={isLayoutVisible ? '' : 'pl-col-chip-layout-hidden'}
                tooltip={_sampleTipFor(lk.rightId, c, ['Click to show/hide this lookup column in the report layout.'])}
                dataAttrs={{ 'data-li': String(i), 'data-lcc': c }}
                onClick={() => {
                  const colMap = buildColSourceMap();
                  const visible = _isSourceVisibleInLayout(lk.rightId, c, colMap, db.aggMode || 'none');
                  if (visible) _hideLookupLayoutAliasesSafely(lk.rightId, c, i);
                  else _showLayoutAliasesForSource(lk.rightId, c);
                  _afterCombineChange();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!lk.rightId) return;
                  const colMap = buildColSourceMap();
                  let alias = '';
                  for (const [a, src] of colMap.entries()) {
                    if (src && src.kind !== 'calc' && src.tid === lk.rightId && src.col === c) { alias = a; break; }
                  }
                  if (!alias) return;
                  setCtxMenu({
                    x: e.clientX, y: e.clientY,
                    items: [{ label: 'Rename', action: () => setRenameTarget(resolveRenameTarget(alias)) }],
                  });
                }}
              />
            );
          })}
          <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0"
            onClick={() => selectAllLookupCols(i)}>All</button>
          <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0"
            onClick={() => selectNoneLookupCols(i)}>None</button>
        </div>
      )}
    </div>
    {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
    {renameTarget && <RenameModal target={renameTarget} onDone={() => _afterCombineChange()} onClose={() => setRenameTarget(null)} />}
    </>
  );
}

function CalcStageComponent({ calc, i }: { calc: CalcStage; i: number }) {
  const cols = projectedCols();
  const colMap = buildColSourceMap();
  const alias = (calc.alias || '').trim();
  const mode = calc.mode || 'math';

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: { label: string; action: () => void }[] } | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  const calcEnabled = calc.enabled !== false;
  const calcV = getValidation()!.items[`calc_${i}`];
  const calcVBlocked = calcV && calcV.blocking;
  const calcVUnresolved = calcV && !calcV.resolved;
  const calcVMsg = calcVUnresolved && calcV.issues[0] ? calcV.issues[0].message : null;

  const stageClasses = [
    'pl-lookup-stage',
    calcVBlocked ? 'pl-lookup-stage--invalid' : '',
    calcVUnresolved && !calcEnabled ? 'pl-lookup-stage--disabled-issue' : '',
    !calcEnabled ? 'pl-stage-disabled' : '',
  ].filter(Boolean).join(' ');

  const handleCalcChange = (prop: CalcProp, e: Event) => {
    const inp = e.target as HTMLInputElement;
    const handler = calcPropHandlers[prop];
    if (handler) {
      handler(calc, inp, i);
      _afterCombineChange();
    }
  };

  const handleCondChange = (j: number, prop: CondProp, e: Event) => {
    const inp = e.target as HTMLInputElement;
    const compare = calc.compare as { conditions?: Array<{ col?: string; op?: string; val?: string }> } | undefined;
    if (!compare?.conditions?.[j]) return;
    const handler = condPropHandlers[prop];
    if (handler) {
      handler(compare.conditions[j], inp);
      _afterCombineChange();
    }
  };

  const colOptsFor = (sel: string) => cols
    .filter(c => c !== alias)
    .map(c => `<option value="${c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}" ${sel === c ? 'selected' : ''}>${colDisplayLabel(c, colMap).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</option>`)
    .join('');

  const builderCtx: CalcBuilderCtx = { calc, i, cols, colOptsFor };
  const builderHtml = calcModeRenderers[mode](builderCtx);

  return (
    <>
    <div class={stageClasses}>
      <div class="pl-stage-label">Calculated column <Tip text={'Create a virtual column from existing columns.\nMath: arithmetic, rolling averages, percentages.\nText: string operations.\nCompare: conditional logic.\nDate: extract date parts.'} />
        <label class="pl-enable-toggle" title={calcEnabled ? 'Disable this calculated column' : 'Enable this calculated column'}>
          <input type="checkbox" checked={calcEnabled} onChange={(e) => handleCalcChange('enabled', e)} />
          <span class="pl-enable-label">{calcEnabled ? 'Enabled' : 'Disabled'}</span>
        </label>
      </div>
      {calcVMsg && <div class="pl-lookup-error">{calcVBlocked ? '\u26D4' : '\u26A0'} {calcVMsg}</div>}
      <div class="pl-lookup-header" style="gap:8px;flex-wrap:wrap">
        <input type="text" placeholder="Output column name" value={calc.alias || ''} style="flex:1;min-width:180px"
          onChange={(e) => handleCalcChange('alias', e)} />
        <button class="btn btn-danger" style="flex-shrink:0" onClick={() => removeCalcStage(i)}>{'\u2715'}</button>
      </div>
      <div class="tab-row" style="margin-top:8px">
        <label class="tab-opt"><input type="radio" name={`calcMode_${i}`} value="math" checked={mode === 'math'} onChange={(e) => handleCalcChange('mode', e)} /><span>Math</span></label>
        <label class="tab-opt"><input type="radio" name={`calcMode_${i}`} value="text" checked={mode === 'text'} onChange={(e) => handleCalcChange('mode', e)} /><span>Text</span></label>
        <label class="tab-opt"><input type="radio" name={`calcMode_${i}`} value="compare" checked={mode === 'compare'} onChange={(e) => handleCalcChange('mode', e)} /><span>Compare</span></label>
        <label class="tab-opt"><input type="radio" name={`calcMode_${i}`} value="date" checked={mode === 'date'} onChange={(e) => handleCalcChange('mode', e)} /><span>Date</span></label>
      </div>
      {/* Event delegation for calc-builder HTML inputs (data-ci/data-cp/data-cond) */}
      <div onChange={(e) => {
        const t = e.target as HTMLElement;
        const ci = t.dataset.ci;
        const cp = t.dataset.cp as CalcProp | undefined;
        const condIdx = t.dataset.cond;
        if (!ci || !cp) return;
        if (condIdx !== undefined) {
          handleCondChange(+condIdx, cp as CondProp, e);
        } else {
          handleCalcChange(cp, e);
        }
      }} dangerouslySetInnerHTML={{ __html: builderHtml }}></div>
      {alias && (
        <div class="pl-lookup-cols" style="margin-top:8px">
          <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Output:</span>
          <Tip text="Right-click the chip to rename this column. The alias input above will update." />
          <Chip
            col={alias}
            label={colDisplayLabel(alias, colMap)}
            selected={_isAliasVisibleInLayout(alias, db.aggMode || 'none')}
            draggable={false}
            chipClass="pl-col-chip"
            dataAttrs={{ 'data-ci': String(i), 'data-ccc': alias }}
            onClick={() => {
              if (!db.selCols) db.selCols = new Set(projectedCols());
              const s = db.selCols;
              if (s.has(alias)) s.delete(alias);
              else s.add(alias);
              _afterCombineChange();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({
                x: e.clientX, y: e.clientY,
                items: [{
                  label: 'Rename', action: () => {
                    const target = resolveRenameTarget(alias);
                    if (!target) return;
                    setRenameTarget(target);
                  },
                }],
              });
            }}
          />
        </div>
      )}
    </div>
    {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
    {renameTarget && <RenameModal target={renameTarget} onDone={() => _afterCombineChange()} onClose={() => setRenameTarget(null)} />}
    </>
  );
}

// ── Main Pipeline Component ──

export function Pipeline() {
  const ids = Object.keys(db.tables);
  const sortedIds = ids.sort((a: string, b: string) => db.tables[a].name.localeCompare(db.tables[b].name));
  const usedAsLookup = new Set((db.lookups || []).map(l => l.rightId).filter(Boolean));
  const usedAsStack = new Set(db.stacks || []);
  const layoutColMap = db.base && db.tables[db.base] ? buildColSourceMap() : new Map();
  const layoutMode = db.aggMode || 'none';

  return (
    <div>
      <BaseStage sortedIds={sortedIds} usedAsLookup={usedAsLookup} usedAsStack={usedAsStack} layoutColMap={layoutColMap} layoutMode={layoutMode} />

      {db.base && db.tables[db.base] && (
        <PipelineArrow id="base" />
      )}

      {(db.lookups || []).map((lk, i) => (
        <div>
          <LookupStage lk={lk} i={i} sortedIds={sortedIds} usedAsLookup={usedAsLookup} usedAsStack={usedAsStack} layoutColMap={layoutColMap} layoutMode={layoutMode} />
          <PipelineArrow id={`lk${i}`} />
        </div>
      ))}

      {(db.calcStages || []).map((calc, i) => (
        <div>
          <CalcStageComponent calc={calc} i={i} />
          <PipelineArrow id={`calc${i}`} />
        </div>
      ))}

      <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;padding:2px 0 8px">
        <div class="pl-add-btn" onClick={() => addLookup()}>{'\uFF0B'} Look up columns from another sheet</div>
        <div class="pl-add-btn" onClick={() => addCalcStage()}>{'\uFF0B'} Add a calculated column from existing sheets</div>
      </div>
    </div>
  );
}

// Legacy render function — calls render() to mount Preact component
export function renderPipeline(_ids: string[]): void {
  const pl = document.getElementById('pipeline');
  if (!pl) return;
  render(<Pipeline />, pl);
}
