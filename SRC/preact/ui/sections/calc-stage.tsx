/**
 * Calc stage — calculated column configuration section.
 *
 * Configures a calculated column with alias, mode (math/text/compare/date),
 * and mode-specific options via calc-builder Preact components.
 * Uses store for state access.
 *
 * Ported from SRC/js/ui/views/pipeline-card.tsx (CalcStageComponent sub-component).
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { getStore } from '../../core/store';
import { buildReportSpecFromState } from '../../core/state';
import { colUserLabel } from '../../core/utils';
import { buildColSourceMap, projectedCols } from '../../catalog/column-catalog';
import { buildSourceCatalog } from '../../catalog/source-catalog';
import {
  _isAliasVisibleInLayout,
  _afterCombineChange,
  _disabledCardCols,
} from '../../query/layout-selection';
import { getValidation } from '../../report/validation';
import { renameCalcAlias } from '../../core/alias-rename';
import { Chip } from '../components/chip';
import { Tip } from '../components/tip';
import { ContextMenu, type CtxMenuItem } from '../components/context-menu';
import { resolveRenameTarget, RenameModal, type RenameTarget } from '../components/rename-modal';
import { calcModeComponents, type ColOption } from '../components/calc-builder';
import type { AppState, CalcStage, CalcMode } from '../../types';

export interface CalcStageProps {
  /** Index of this calc stage in the calcStages array. */
  i: number;
}

export function CalcStageSection({ i }: CalcStageProps) {
  const [state, setState] = useState<AppState>(getStore().getState());
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: CtxMenuItem[] } | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  useEffect(() => getStore().subscribe(s => setState(s)), []);

  const calc = state.calcStages[i];
  if (!calc) return null;

  const aggMode = state.aggMode || 'none';
  const alias = (calc.alias || '').trim();
  const mode: CalcMode = calc.mode || 'math';
  const reportSpec = buildReportSpecFromState(state);
  const sourceCatalog = buildSourceCatalog(state.tables);
  const cols = projectedCols(reportSpec, sourceCatalog);
  const colMap = buildColSourceMap();

  const calcEnabled = calc.enabled !== false;
  const calcV = getValidation().items[`calc_${i}`];
  const calcVBlocked = calcV && calcV.blocking;
  const calcVUnresolved = calcV && !calcV.resolved;
  const calcVMsg = calcVUnresolved && calcV.issues[0] ? calcV.issues[0].message : null;

  const stageClasses = [
    'pl-lookup-stage',
    calcVBlocked ? 'pl-lookup-stage--invalid' : '',
    calcVUnresolved && !calcEnabled ? 'pl-lookup-stage--disabled-issue' : '',
    !calcEnabled ? 'pl-stage-disabled' : '',
  ].filter(Boolean).join(' ');

  const updateCalc = useCallback((updater: (draft: CalcStage) => void) => {
    getStore().update(draft => {
      const calcDraft = draft.calcStages[i];
      if (calcDraft) updater(calcDraft);
    });
    _afterCombineChange();
  }, [i]);

  const handleEnabledChange = useCallback((checked: boolean) => {
    const wasEnabled = calc.enabled !== false;
    updateCalc(calcDraft => {
      calcDraft.enabled = checked;
      const calcAlias = (calcDraft.alias || '').trim();
      if (!calcAlias) return;
      if (wasEnabled && !checked) {
        const storeState = getStore().getState();
        if (storeState.selCols instanceof Set && _isAliasVisibleInLayout(calcAlias, storeState.aggMode || 'none')) {
          (calcDraft as Record<string, unknown>)._prevSelState = true;
          _disabledCardCols.add(calcAlias);
        } else {
          (calcDraft as Record<string, unknown>)._prevSelState = false;
        }
      } else if (!wasEnabled && checked) {
        const storeState = getStore().getState();
        if ((calcDraft as Record<string, unknown>)._prevSelState && storeState.selCols instanceof Set) {
          (storeState.selCols as Set<string>).add(calcAlias);
          _disabledCardCols.delete(calcAlias);
        }
        delete (calcDraft as Record<string, unknown>)._prevSelState;
      }
    });
  }, [i, calc.enabled, updateCalc]);

  const handleAliasChange = useCallback((val: string) => {
    renameCalcAlias(i, val);
  }, [i]);

  const handleModeChange = useCallback((newMode: CalcMode) => {
    updateCalc(calcDraft => {
      calcDraft.mode = newMode;
      delete calcDraft.math;
      delete calcDraft.compare;
      delete calcDraft.text;
      delete calcDraft.date;
      const modeDefaults: Record<CalcMode, () => unknown> = {
        math: () => ({ strategy: 'stepChain', steps: [{ type: 'column', value: '' }, { type: 'column', value: '', op: '+' }] }),
        text: () => ({ operation: 'combine', parts: [{ type: 'column', value: '' }] }),
        compare: () => ({ compareMode: 'AND', conditions: [{ col: '', op: '=', val: '' }], trueValue: { type: 'number', value: '1' }, falseValue: { type: 'number', value: '0' } }),
        date: () => ({ operation: 'extract', source: { type: 'column', value: '' }, part: 'year', output: 'number' }),
      };
      (calcDraft as Record<string, unknown>)[newMode] = modeDefaults[newMode]();
    });
  }, [updateCalc]);

  const handlePropChange = useCallback((prop: string, val: string) => {
    updateCalc(calcDraft => {
      switch (prop) {
        case 'mathOp': {
          (calcDraft as Record<string, unknown>).mathOp = val;
          const defaults: Record<string, () => unknown> = {
            ARITH: () => ({ strategy: 'stepChain', steps: [{ type: 'column', value: '' }, { type: 'column', value: '', op: '+' }] }),
            ROLLAVG: () => ({ strategy: 'stepChain', steps: [{ type: 'column', value: '' }] }),
            PCTTOTAL: () => ({ strategy: 'stepChain', steps: [{ type: 'column', value: '' }] }),
          };
          calcDraft.math = defaults[val]?.();
          break;
        }
        case 'mathOperator': {
          const math = calcDraft.math as { steps?: Array<{ type?: string; value?: string; op?: string }> } | undefined;
          if (math?.steps) {
            if (math.steps.length < 2) math.steps.push({ type: 'column', value: '', op: val });
            else math.steps[1].op = val;
          }
          break;
        }
        case 'leftCol': {
          const math = calcDraft.math as { steps?: Array<{ type?: string; value?: string }> } | undefined;
          if (math?.steps && math.steps.length > 0) math.steps[0] = { type: 'column', value: val };
          break;
        }
        case 'rightCol': {
          const math = calcDraft.math as { steps?: Array<{ type?: string; value?: string; op?: string }> } | undefined;
          if (math?.steps) {
            if (math.steps.length < 2) math.steps.push({ type: 'column', value: '', op: '+' });
            math.steps[1] = { ...math.steps[1], type: 'column', value: val };
          }
          break;
        }
        case 'window':
          (calcDraft as Record<string, unknown>).window = String(Math.max(1, parseInt(val, 10) || 7));
          break;
        case 'textSource': {
          const text = calcDraft.text as { source?: { type: string; value: string } } | undefined;
          if (text) text.source = { type: 'column', value: val };
          break;
        }
        case 'textCount': {
          const text = calcDraft.text as { count?: number } | undefined;
          if (text) text.count = Math.max(1, parseInt(val, 10) || 1);
          break;
        }
        case 'textStart': {
          const text = calcDraft.text as { start?: number } | undefined;
          if (text) text.start = Math.max(1, parseInt(val, 10) || 1);
          break;
        }
        case 'textLength': {
          const text = calcDraft.text as { length?: number } | undefined;
          if (text) text.length = Math.max(1, parseInt(val, 10) || 1);
          break;
        }
        case 'compareMode': {
          const compare = calcDraft.compare as { compareMode?: string } | undefined;
          if (compare) compare.compareMode = val;
          break;
        }
        case 'dateSource': {
          const date = calcDraft.date as { source?: { type: string; value: string } } | undefined;
          if (date) date.source = { type: 'column', value: val };
          break;
        }
        case 'datePart': {
          const date = calcDraft.date as { part?: string; output?: string } | undefined;
          if (date) {
            date.part = val;
            if ((val === 'year' || val === 'week') && date.output !== 'number') date.output = 'number';
          }
          break;
        }
        case 'dateOutput': {
          const date = calcDraft.date as { output?: string } | undefined;
          if (date) date.output = val;
          break;
        }
        case 'dateFmtFirst': case 'dateFmtSecond': case 'dateFmtThird': {
          if (!calcDraft.date) calcDraft.date = {};
          const date = calcDraft.date as Record<string, unknown>;
          if (!date.inputFormat) date.inputFormat = {};
          const key = prop === 'dateFmtFirst' ? 'first' : prop === 'dateFmtSecond' ? 'second' : 'third';
          (date.inputFormat as Record<string, string>)[key] = val;
          break;
        }
      }
    });
  }, [updateCalc]);

  const handleCondChange = useCallback((j: number, prop: string, val: string) => {
    updateCalc(calcDraft => {
      const compare = calcDraft.compare as { conditions?: Array<{ col?: string; op?: string; val?: string }> } | undefined;
      if (!compare?.conditions?.[j]) return;
      const cond = compare.conditions[j];
      switch (prop) {
        case 'col': cond.col = val; break;
        case 'op': cond.op = val; break;
        case 'val': cond.val = val; break;
      }
    });
  }, [updateCalc]);

  const removeCalcStage = useCallback(() => {
    getStore().update(draft => { draft.calcStages.splice(i, 1); });
    _afterCombineChange();
  }, [i]);

  const colOptsFor = useCallback((sel: string): ColOption[] => cols
    .filter(c => c !== alias)
    .map(c => {
      const src = colMap.get(c);
      const label = src && src.kind !== 'calc' ? colUserLabel(src.tid, src.col) : c;
      return { value: c, label, selected: sel === c };
    }), [cols, alias, colMap]);

  const Builder = calcModeComponents[mode];

  return (
    <>
      <div class={stageClasses}>
        <div class="pl-stage-label">
          Calculated column <Tip text={'Create a virtual column from existing columns — it does not change your source data.\n\n• Math: add, subtract, multiply, divide columns, or compute rolling averages and percentages\n• Text: join, trim, or extract parts of text\n• Compare: if/then logic — return one value if a condition is met, another if not\n• Date: pull out the year, month, day, or other parts from a date column'} />
          <label class="pl-enable-toggle" title={calcEnabled ? 'Disable this calculated column' : 'Enable this calculated column'}>
            <input type="checkbox" checked={calcEnabled} onChange={e => handleEnabledChange((e.target as HTMLInputElement).checked)} />
            <span class="pl-enable-label">{calcEnabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>
        {calcVMsg && <div class="pl-lookup-error">{calcVBlocked ? '⛔' : '⚠'} {calcVMsg}</div>}
        <div class="pl-lookup-header" style="gap:8px;flex-wrap:wrap">
          <input
            type="text"
            placeholder="Output column name"
            value={calc.alias || ''}
            style="flex:1;min-width:180px"
            onChange={e => handleAliasChange((e.target as HTMLInputElement).value)}
          />
          <button class="btn btn-danger" style="flex-shrink:0" onClick={removeCalcStage}>{'✕'}</button>
        </div>
        <div class="tab-row" style="margin-top:8px">
          {(['math', 'text', 'compare', 'date'] as CalcMode[]).map(m => (
            <label key={m} class="tab-opt">
              <input type="radio" name={`calcMode_${i}`} value={m} checked={mode === m} onChange={() => handleModeChange(m)} />
              <span>{m.charAt(0).toUpperCase() + m.slice(1)}</span>
            </label>
          ))}
        </div>
        <Builder calc={calc} i={i} cols={cols} colOptsFor={colOptsFor} onPropChange={handlePropChange} onCondChange={handleCondChange} />
        {alias && (
          <div class="pl-lookup-cols" style="margin-top:8px">
            <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Output:</span>
            <Tip text="This chip represents your new calculated column. Double-click it to show or hide it in the report. Right-click to rename it — the name field above will update too." />
            <Chip
              col={alias}
              label={(() => { const src = colMap.get(alias); return src && src.kind !== 'calc' ? colUserLabel(src.tid, src.col) : alias; })()}
              selected={_isAliasVisibleInLayout(alias, aggMode)}
              draggable={false}
              chipClass="pl-col-chip"
              dataAttrs={{ 'data-ci': String(i), 'data-ccc': alias }}
              onClick={() => {
                getStore().update(draft => {
                  if (!draft.selCols) {
                    const rs = buildReportSpecFromState(draft);
                    const sc = buildSourceCatalog(draft.tables);
                    draft.selCols = new Set(projectedCols(rs, sc));
                  }
                  const s = draft.selCols as Set<string>;
                  if (s.has(alias)) s.delete(alias);
                  else s.add(alias);
                });
                _afterCombineChange();
              }}
              onContextMenu={e => {
                e.preventDefault();
                setCtxMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [{
                    label: 'Rename',
                    action: () => {
                      const target = resolveRenameTarget(alias);
                      if (target) setRenameTarget(target);
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
