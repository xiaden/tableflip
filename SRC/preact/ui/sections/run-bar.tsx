/**
 * Run bar — run button and status display.
 *
 * Shows a validation status pill (healthy/blocked) and a "Run Report" button.
 * On click, executes the report via the engine and displays row count status.
 *
 * Ported from SRC/js/ui/views/query-builder.tsx (runRow section).
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { getStore } from '../../core/store';
import { toast } from '../../core/utils';
import { Tip } from '../components/tip';
import { RowExplosionDialog } from '../components/row-explosion-dialog';
import { getValidation, invalidateValidation } from '../../report/validation';
import { runReport as executeReport, RowExplosionError } from '../../report/engine';
import type { AppState, ReportSpec } from '../../types';

export interface RunBarProps {
  /** Callback invoked after a successful report run with the result. */
  onResult?: (result: Record<string, unknown>) => void;
}

export function RunBar({ onResult }: RunBarProps) {
  const [state, setState] = useState<AppState>(getStore().getState());
  const [runStatus, setRunStatus] = useState<string>('');
  const [explosionDialog, setExplosionDialog] = useState<{ projectedCount: number; limit: number } | null>(null);

  useEffect(() => getStore().subscribe(s => setState(s)), []);

  const base = state.base;
  const hasBaseConfigured = !!base;

  if (!hasBaseConfigured) return null;

  const v = getValidation();
  const blocked = v.reportStatus === 'blocked';
  const items = Object.values(v.items);
  const issueCount = items.filter(it => it.blocking).length;

  const statusPill = blocked
    ? { text: `⚠ Blocked (${issueCount} issue${issueCount !== 1 ? 's' : ''})`, bg: 'rgba(200,60,60,0.18)', color: '#e07070', border: '1px solid rgba(200,60,60,0.35)' }
    : { text: '✓ Healthy', bg: 'rgba(50,180,100,0.15)', color: '#6ec87e', border: '1px solid rgba(50,180,100,0.3)' };

  const runDisabled = blocked;

  const runQuery = useCallback((overrideLimit?: number) => {
    const currentState = getStore().getState();
    if (!currentState.base || !currentState.tables[currentState.base]) return;

    invalidateValidation();
    const val = getValidation();
    if (val.reportStatus === 'blocked') {
      const blockingItems = Object.values(val.items).filter(item => item.blocking);
      const firstMsg = blockingItems[0]?.issues?.[0]?.message || 'missing source data';
      toast(`Can't run — fix source issues first (${firstMsg}${blockingItems.length > 1 ? ` and ${blockingItems.length - 1} more` : ''}).`, 'err');
      return;
    }

    const hasAgg = currentState.aggMode === 'group' && (currentState.groupBy.length > 0 || currentState.aggregates.length > 0);
    if (!hasAgg && !['totals', 'subtotals'].includes(currentState.aggMode) && currentState.selCols && currentState.selCols.size === 0) {
      toast('No output columns selected — click All or pick at least one column.', 'err');
      return;
    }

    setRunStatus('Running…');
    setTimeout(() => {
      try {
        // Build a ReportSpec from the current AppState
        const reportSpec: ReportSpec = {
          id: null,
          name: '',
          enabled: true,
          pipeline: {
            base: currentState.base,
            baseCols: currentState.baseCols,
            stacks: currentState.stacks,
            lookups: currentState.lookups,
            calculatedColumns: currentState.calcStages,
            detailBands: currentState.detailBands || [],
          },
          outputColumns: currentState.colOrder,
          filters: currentState.filters,
          sorts: currentState.sorts,
          aggregation: {
            mode: currentState.aggMode,
            groupBy: currentState.groupBy,
            aggregates: currentState.aggregates,
            colTotals: currentState.colTotals,
            subtotalBy: currentState.subtotalBy,
            subtotalFns: currentState.subtotalFns,
            subtotalGrandTotal: currentState.subtotalGrandTotal,
            subtotalSpacer: currentState.subtotalSpacer,
            subtotalOnTop: currentState.subtotalOnTop,
            subtotalStrategy: currentState.subtotalStrategy,
          },
          mergeDisplay: {
            mergedCols: currentState.mergedCols,
            mergeGroupUnderline: currentState.mergeGroupUnderline,
          },
          outputDefinition: null,
          publish: { enabled: false, tableName: '' },
          detailBandMode: currentState.detailBandMode || 'separate',
        };

        const resultSet = overrideLimit != null
          ? executeReport(reportSpec, currentState.tables, overrideLimit)
          : executeReport(reportSpec, currentState.tables);
        if (!resultSet) throw new Error('No result set returned');

        const displayRows = resultSet.rows.filter((r: Record<string, unknown>) => !r._row_type);
        const hasTotals = !!resultSet.metadata.totalsRow;
        const hasSubs = !!resultSet.metadata.hasSubtotals;

        const result = {
          rows: resultSet.rows,
          totalsRow: resultSet.metadata.totalsRow || null,
          cols: resultSet.columns,
          hasSubtotals: hasSubs,
        };

        getStore().update(draft => { draft.result = result; });

        let statusText = displayRows.length.toLocaleString() + ' rows';
        if (hasTotals) statusText += ' + grand total';
        if (hasSubs) statusText += ' (subtotals)';
        setRunStatus(statusText);

        if (onResult) onResult(result);
      } catch (ex: unknown) {
        if (ex instanceof RowExplosionError) {
          setExplosionDialog({ projectedCount: ex.projectedCount, limit: ex.limit });
          setRunStatus('Row limit exceeded');
          return;
        }
        setRunStatus('Error');
        toast('Query error: ' + (ex as Error).message, 'err');
      }
    }, 20);
  }, [onResult]);

  const handleExplosionProceed = useCallback(() => {
    setExplosionDialog(null);
    // Re-run with an elevated limit: at least 50,000 or 2× the projected count
    const elevated = Math.max(50_000, Math.ceil((explosionDialog?.projectedCount ?? 50_000) * 2));
    runQuery(elevated);
  }, [runQuery, explosionDialog]);

  const handleExplosionCancel = useCallback(() => {
    setExplosionDialog(null);
    setRunStatus('Cancelled');
  }, []);

  return (
    <div id="runRow" style="display:flex;align-items:center;gap:8px;padding:8px 0">
      <span
        id="reportStatusPill"
        style={{
          background: statusPill.bg,
          color: statusPill.color,
          border: statusPill.border,
          fontSize: '0.72rem',
          padding: '2px 8px',
          borderRadius: '10px',
        }}
      >
        {statusPill.text}
      </span>
      <button id="runBtn" class="btn btn-primary" disabled={runDisabled} onClick={() => runQuery()} title="Generate your report applying all sheet combinations, filters, sort order, and summary settings.">
        Run Report <Tip text={"Generate your report. This applies all your:\n• Sheet combinations and lookups\n• Calculated columns\n• Filters and sort order\n• Summary settings\n\nto produce the final output."} />
      </button>
      <span id="runStatus" style="font-size:0.72rem;color:var(--muted)">{runStatus}</span>
      {explosionDialog && (
        <RowExplosionDialog
          projectedCount={explosionDialog.projectedCount}
          limit={explosionDialog.limit}
          onProceed={handleExplosionProceed}
          onCancel={handleExplosionCancel}
        />
      )}
    </div>
  );
}
