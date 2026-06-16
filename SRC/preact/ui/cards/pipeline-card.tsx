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
 * - Preview result data is computed via buildPreview() and passed as a prop to PipelineArrow
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { getStore } from '../../core/store';
import { _afterCombineChange } from '../../query/layout-selection';
import { BaseStage } from '../sections/base-stage';
import { StackSheets } from '../sections/stack-sheets';
import { PipelineArrow } from '../sections/pipeline-arrow';
import { LookupStage } from '../sections/lookup-stage';
import { CalcStageSection } from '../sections/calc-stage';
import { DetailBandStage } from '../sections/detail-band-stage';
import { createDetailBandSpec } from '../../core/state';
import { Tip } from '../components/tip';
import { buildPreview } from '../../report/preview-builder';
import type { PreviewResult } from '../../report/preview-builder';
import type { AppState } from '../../types';

export function PipelineCard() {
  const [state, setState] = useState<AppState>(getStore().getState());
  const [previews, setPreviews] = useState<Record<string, PreviewResult>>({});

  // Subscribe to store changes and clear preview cache on any state change
  useEffect(() => getStore().subscribe(s => {
    setState(s);
    setPreviews({});
  }), []);

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

  const computePreview = useCallback((id: string) => {
    const currentState = getStore().getState();
    const result = buildPreview(id, currentState);
    setPreviews(prev => ({ ...prev, [id]: result }));
  }, []);

  const hasBase = !!(base && tables[base]);

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
        <PipelineArrow id="base" result={previews['base']} onOpen={computePreview} />
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
          <PipelineArrow id={`lk${i}`} result={previews[`lk${i}`]} onOpen={computePreview} />
        </div>
      ))}

      {/* Calc stages */}
      {calcStages.map((_calc, i) => (
        <div key={`calc-${i}`}>
          <CalcStageSection i={i} />
          <PipelineArrow id={`calc${i}`} result={previews[`calc${i}`]} onOpen={computePreview} />
        </div>
      ))}

      {/* Detail band stages */}
      {detailBands.map((_band, i) => (
        <div key={`band-${i}`}>
          <DetailBandStage
            i={i}
            sortedIds={sortedIds}
            usedAsLookup={usedAsLookup}
            usedAsStack={usedAsStack}
            usedAsBase={base}
          />
          <PipelineArrow id={`band${i}`} result={previews[`band${i}`]} onOpen={computePreview} />
        </div>
      ))}

      {/* Add buttons */}
      {hasBase && (
        <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;padding:2px 0 8px">
          <div class="pl-add-btn" onClick={addLookup}>
            {'＋'} Add columns from another sheet
          </div>
          <div class="pl-add-btn" onClick={addCalcStage}>
            {'＋'} Add a calculated column
          </div>
          <div class="pl-add-btn" onClick={addDetailBand}>
            {'＋'} Add detail rows from another
          </div>
        </div>
      )}
    </div>
  );
}
