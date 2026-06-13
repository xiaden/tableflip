/**
 * Pipeline card — combines all pipeline stages into a single card.
 *
 * Renders the base table selector, stacked sheets, lookup stages,
 * calculated column stages, and detail band stages with pipeline arrows
 * between them. Also provides buttons to add new lookups, calculated
 * columns, and detail bands.
 *
 * Ported from SRC/js/ui/views/pipeline-card.tsx. Key differences:
 * - Composes Preact section components instead of inline sub-components
 * - Uses store.subscribe() for reactive updates instead of re-render calls
 * - Preview HTML builder is passed as a prop to PipelineArrow
 */

import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { getStore } from '../../core/store';
import { buildColSourceMap } from '../../catalog/column-catalog';
import { buildSourceCatalog } from '../../catalog/source-catalog';
import { _afterCombineChange, _previewOpen, _disabledCardCols } from '../../query/layout-selection';
import { BaseStage } from '../sections/base-stage';
import { StackSheets } from '../sections/stack-sheets';
import { PipelineArrow } from '../sections/pipeline-arrow';
import { LookupStage } from '../sections/lookup-stage';
import { CalcStageSection } from '../sections/calc-stage';
import { DetailBandStage } from '../sections/detail-band-stage';
import { createDetailBandSpec } from '../../core/state';
import { invalidateValidation } from '../../report/validation';
import { Tip } from '../components/tip';
import type { AppState } from '../../types';

export function PipelineCard() {
  const [state, setState] = useState<AppState>(getStore().getState());

  useEffect(() => getStore().subscribe(s => setState(s)), []);

  const tables = state.tables;
  const base = state.base;
  const lookups = state.lookups || [];
  const calcStages = state.calcStages || [];
  const detailBands = state.detailBands || [];
  const stacks = state.stacks || [];

  const ids = Object.keys(tables);
  const sortedIds = ids.sort((a, b) => tables[a].name.localeCompare(tables[b].name));
  const usedAsLookup = new Set(lookups.map(l => l.rightId).filter(Boolean));
  const usedAsStack = new Set(stacks);

  const addLookup = useCallback(() => {
    const currentState = getStore().getState();
    if (!currentState.base) return;
    getStore().update(draft => {
      if (!draft.lookups) draft.lookups = [];
      draft.lookups.push({
        rightId: '',
        keyPairs: [{ left: '', right: '' }],
        cols: [],
        required: false,
        enabled: true,
        duplicatePolicy: { mode: 'block' },
      });
    });
    _afterCombineChange();
  }, []);

  const addCalcStage = useCallback(() => {
    const currentState = getStore().getState();
    if (!currentState.base) return;
    getStore().update(draft => {
      if (!draft.calcStages) draft.calcStages = [];
      draft.calcStages.push({
        alias: '',
        mode: 'math',
        math: {
          strategy: 'stepChain',
          steps: [
            { type: 'column', value: '' },
            { type: 'column', value: '', op: '+' },
          ],
        },
        enabled: true,
      });
    });
    _afterCombineChange();
  }, []);

  const addDetailBand = useCallback(() => {
    const currentState = getStore().getState();
    if (!currentState.base) return;
    getStore().update(draft => {
      if (!draft.detailBands) draft.detailBands = [];
      draft.detailBands.push(createDetailBandSpec());
    });
    _afterCombineChange();
  }, []);

  const setBandMode = useCallback((mode: 'separate' | 'stack') => {
    getStore().update(draft => {
      draft.detailBandMode = mode;
    });
    invalidateValidation();
  }, []);

  const hasBase = !!(base && tables[base]);
  const enabledBandCount = detailBands.filter(b => b.enabled !== false).length;

  // ── Band reorder drag-and-drop ──────────────────────────────────
  const dragBandIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const onBandDragStart = useCallback((idx: number, e: DragEvent) => {
    dragBandIdx.current = idx;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    }
  }, []);

  const onBandDragOver = useCallback((idx: number, e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  }, []);

  const onBandDragEnd = useCallback(() => {
    dragBandIdx.current = null;
    setDragOverIdx(null);
  }, []);

  const onBandDrop = useCallback((targetIdx: number, e: DragEvent) => {
    e.preventDefault();
    const sourceIdx = dragBandIdx.current;
    if (sourceIdx === null || sourceIdx === targetIdx) {
      setDragOverIdx(null);
      return;
    }

    getStore().update(draft => {
      if (!draft.detailBands || draft.detailBands.length < 2) return;
      const bands = [...draft.detailBands];
      const [moved] = bands.splice(sourceIdx, 1);
      bands.splice(targetIdx, 0, moved);
      draft.detailBands = bands;
    });
    invalidateValidation();
    _afterCombineChange();
    dragBandIdx.current = null;
    setDragOverIdx(null);
  }, []);

  return (
    <div id="pipeline" class="pipeline">
      <div class="pl-top-pair">
        <BaseStage sortedIds={sortedIds} />

        {hasBase && (
          <>
            <div class="pl-h-arrow">
              <div class="pl-h-line" />
              <div class="pl-h-head" />
            </div>
            <div class="pl-v-arrow-stacked">
              <div class="pl-arrow-line" />
              <div class="pl-arrow-head" />
            </div>
            <div class="pl-stage">
              <div class="pl-stage-label">
                Include rows from <Tip text="Add sheets with the same columns to get more rows — like stacking spreadsheets on top of each other. For example: Jan Sales + Feb Sales + Mar Sales." />
              </div>
              <StackSheets sortedIds={sortedIds} usedAsLookup={usedAsLookup} usedAsStack={usedAsStack} />
            </div>
          </>
        )}
      </div>

      {hasBase && (
        <PipelineArrow id="base" />
      )}

      {/* Lookup stages */}
      {lookups.map((_lk, i) => (
        <div key={`lk-${i}`}>
          <LookupStage
            i={i}
            sortedIds={sortedIds}
            usedAsLookup={usedAsLookup}
            usedAsStack={usedAsStack}
          />
          <PipelineArrow id={`lk${i}`} />
        </div>
      ))}

      {/* Calc stages */}
      {calcStages.map((_calc, i) => (
        <div key={`calc-${i}`}>
          <CalcStageSection i={i} />
          <PipelineArrow id={`calc${i}`} />
        </div>
      ))}

      {/* Mode toggle — visible when 2+ bands are enabled */}
      {enabledBandCount >= 2 && (
        <div class="pl-band-mode-toggle" style="display:flex;align-items:center;gap:8px;padding:4px 8px;flex-wrap:wrap">
          <span>Multiple bands:</span>
          <label style="display:inline-flex;align-items:center;gap:2px;cursor:pointer">
            <input
              type="radio"
              name="bandMode"
              value="separate"
              checked={state.detailBandMode === 'separate'}
              onChange={() => setBandMode('separate')}
            />
            Separate bands (under each row)
          </label>
          <label style="display:inline-flex;align-items:center;gap:2px;cursor:pointer">
            <input
              type="radio"
              name="bandMode"
              value="stack"
              checked={state.detailBandMode === 'stack'}
              onChange={() => setBandMode('stack')}
            />
            Stack side-by-side (cross-product)
          </label>
          <Tip text={'Separate: each parent row is followed by its matching child rows from each band.\n\nStack: child rows from all bands are combined for each parent row (like a cross-product). Warning: this can produce many rows.'} />
        </div>
      )}

      {/* Detail band stages */}
      {detailBands.map((_band, i) => (
        <div
          key={`band-${i}`}
          draggable={true}
          onDragStart={(e: DragEvent) => onBandDragStart(i, e)}
          onDragOver={(e: DragEvent) => onBandDragOver(i, e)}
          onDragEnd={onBandDragEnd}
          onDrop={(e: DragEvent) => onBandDrop(i, e)}
          style={dragOverIdx === i ? 'opacity:0.5;border-top:2px solid var(--accent,#4a9eff)' : ''}
        >
          <DetailBandStage
            i={i}
            sortedIds={sortedIds}
            usedAsLookup={usedAsLookup}
            usedAsStack={usedAsStack}
            usedAsBase={base}
          />
          <PipelineArrow id={`band${i}`} />
        </div>
      ))}

      {/* Add buttons */}
      {hasBase && (
        <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;padding:2px 0 8px">
          <div class="pl-add-btn" onClick={addLookup}>
            {'＋'} Look up columns from another sheet
          </div>
          <div class="pl-add-btn" onClick={addCalcStage}>
            {'＋'} Add a calculated column from existing sheets
          </div>
          <div class="pl-add-btn" onClick={addDetailBand}>
            {'＋'} Add related details from another sheet
          </div>
        </div>
      )}
    </div>
  );
}
