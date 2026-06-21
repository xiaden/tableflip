/**
 * Three-row column header component for AG Grid.
 *
 * Implements AG Grid's `headerComponent` interface (receives IHeaderParams merged
 * with custom headerComponentParams). Renders three vertically stacked drop rows:
 *
 * - Top row: column label / join key pairs / report column chips (primary drop zone)
 * - Middle row: detail band sheet-name chips (drop zone for sheet chips)
 * - Bottom row: extra match key chips (drop zone for additional join keys)
 *
 * Each row has onDragOver (preventDefault to allow drop) and onDrop handlers.
 * Drop events stopPropagation to prevent AG Grid's built-in sort/filter from triggering.
 * Click events on the label area are NOT stopped, so AG Grid's built-in sort still works.
 *
 * Phase 1: Renders placeholder content. Actual store mutations come in Phases 2-4 (all done).
 * Phase 2: Top row drop handler implemented — parses column chips, handles
 *          empty cell (add to output), same sheet (replace), different sheet (join).
 * Phase 3: Middle row drop handler implemented — accepts sheet chips only,
 *          creates DetailBandSpec entries, renders band chips with table color.
 * Phase 4: Bottom row drop handler implemented — accepts column chips only,
 *          adds extra key pairs to existing lookups (silent join keys, no
 *          output columns). Shows red error state if no matching lookup exists.
 */

import { useCallback, useState, useEffect } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ChipMUI from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import type { IHeaderParams } from 'ag-grid-community';
import { getStore } from '../core/store';
import { invalidateValidation } from '../report/validation';
import { _afterCombineChange } from '../query/layout-selection';
import { buildColSourceMap } from '../catalog/column-catalog';
import { getTableColor, tableShortName, chipFgColor } from '../core/utils';
import type { LookupSpec, DetailBandSpec, AppState } from '../types';
import { JoinKeyPair } from './join-key-pair';
import { JoinOptionsPopup } from './join-options-popup';
import { BandConfigModal } from './band-config-modal';

/**
 * Custom params passed via headerComponentParams, merged with AG Grid's IHeaderParams.
 */
export interface ThreeRowHeaderCustomParams {
  /** Display label text (computed by makeResultCols) */
  label: string;
  /** Table color for the left stripe (null = no stripe) */
  color: string | null;
  /** User-defined rename label */
  renamed: string | undefined;
  /** Original physical column name */
  origCol: string | null;
  /** Callback for rename action */
  onRename: (() => void) | null;
  /** Callback for clear rename action */
  onClear: (() => void) | null;
  /** Callback for right-click context menu */
  onContextMenu: ((e: MouseEvent) => void) | null;
}

/**
 * Full props type: AG Grid's IHeaderParams merged with our custom params.
 * AG Grid merges headerComponentParams with its internal params before passing
 * to the header component.
 */
export type ThreeRowHeaderProps = IHeaderParams & ThreeRowHeaderCustomParams;

/** Height of each drop row in pixels. */
const ROW_HEIGHT = 28;

/**
 * Parse dropped chip data from a drag event.
 * Returns the parsed object or null if parsing fails.
 */
function parseDropData(e: ReactDragEvent): Record<string, unknown> | null {
  try {
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Three-row column header React component for AG Grid.
 *
 * Used as `headerComponent` in column definitions. Receives IHeaderParams
 * (from AG Grid) merged with ThreeRowHeaderCustomParams (from headerComponentParams).
 *
 * The top row displays the column label and acts as the primary drop zone.
 * The middle row is reserved for detail band sheet-name chips.
 * The bottom row is reserved for extra match key chips.
 */
export function ThreeRowHeader(props: ThreeRowHeaderProps) {
  const { displayName, progressSort, label, color, column } = props;

  // Use the computed label (from headerComponentParams) or fall back to displayName (from AG Grid)
  const displayLabel = label || displayName || '';

  // Subscribe to store for reactive rendering of band chips in the middle row
  const [state, setState] = useState<AppState>(getStore().getState());
  useEffect(() => getStore().subscribe((s) => setState(s)), []);

  // Per-column error state — keyed by headerField, value is the error message.
  // Set when a chip is dropped but cannot be resolved (e.g. no matching lookup exists).
  // Used for red border/background + tooltip on the column header area.
  const [columnErrors, setColumnErrors] = useState<Record<string, string>>({});

  // ── Join options popup state (P5-S3, P5-S6) ──────────────────────────────
  // When a gear icon on a JoinKeyPair is clicked, we store the anchor element
  // and the lookup index to display the JoinOptionsPopup.
  const [gearAnchor, setGearAnchor] = useState<HTMLElement | null>(null);
  const [gearLookupIdx, setGearLookupIdx] = useState<number>(-1);

  /** Handle gear icon click from JoinKeyPair — opens the join options popup. */
  const handleGearClick = useCallback((lookupIndex: number, anchorEl: HTMLElement) => {
    setGearAnchor(anchorEl);
    setGearLookupIdx(lookupIndex);
  }, []);

  /** Close the join options popup. */
  const handleGearClose = useCallback(() => {
    setGearAnchor(null);
    setGearLookupIdx(-1);
  }, []);

  // ── Band config modal state (P6-S5) ──────────────────────────────────────
  // When a gear icon on a band chip is clicked, we store the band ID
  // to display the BandConfigModal.
  const [bandConfigId, setBandConfigId] = useState<string | null>(null);

  /** Handle gear icon click on a band chip — opens the band config modal. */
  const handleBandGearClick = useCallback((bandId: string) => {
    setBandConfigId(bandId);
  }, []);

  /** Close the band config modal. */
  const handleBandConfigClose = useCallback(() => {
    setBandConfigId(null);
  }, []);

  // ── Column clear (×) handler (P7-S2, P7-S5) ─────────────────────────────
  // Clears ALL chips and configuration for this column header:
  // - Removes the column from selCols and colOrder
  // - Removes lookups where this column's field is the left side of a key pair
  // - Removes bands assigned to this column (bands whose parent key pairs reference this field)
  // - Removes match keys related to this column in lookups
  // - Clears the per-column error state
  // Uses a single store.update() draft for atomicity.
  const handleClearColumn = useCallback(() => {
    const colDef = column.getColDef();
    const field = colDef.field;
    if (!field) return;

    const store = getStore();
    const colMap = buildColSourceMap();
    const headerSource = colMap.get(field);
    const isPhys = headerSource && headerSource.kind !== 'calc' && headerSource.kind !== 'band';
    const headerPhys = isPhys ? (headerSource as { tid: string; col: string }).col : undefined;

    store.update(draft => {
      // Remove from selCols
      (draft.selCols as Set<string>).delete(field);

      // Remove from colOrder
      const orderIdx = draft.colOrder.indexOf(field);
      if (orderIdx >= 0) draft.colOrder.splice(orderIdx, 1);

      // Remove lookups where this column's physical name is the left side of keyPairs[0]
      if (headerPhys) {
        draft.lookups = draft.lookups.filter(lk => {
          // Keep lookups where the first key pair's left side is NOT this column
          return !(lk.keyPairs.length > 0 && lk.keyPairs[0].left === headerPhys);
        });

        // Remove extra key pairs referencing this column's field from remaining lookups
        for (const lk of draft.lookups) {
          lk.keyPairs = lk.keyPairs.filter(kp => kp.left !== headerPhys && kp.left !== field);
        }
      }

      // Remove detail bands whose parent key pairs reference this column's field
      if (headerPhys) {
        draft.detailBands = draft.detailBands.filter(band => {
          // Keep bands that have NO key pair referencing this column
          return !band.keyPairs.some(kp => kp.left === headerPhys || kp.left === field);
        });
      }

      // Remove filters referencing this column
      draft.filters = draft.filters.filter(f => f.col !== field);

      // Remove sorts referencing this column
      draft.sorts = draft.sorts.filter(s => s.col !== field);

      // Remove aggregates referencing this column
      draft.aggregates = draft.aggregates.filter(a => a.col !== field);

      // Remove from groupBy
      draft.groupBy = draft.groupBy.filter(g => g !== field);

      // Remove from subtotalBy
      draft.subtotalBy = draft.subtotalBy.filter(s => s !== field);
    });

    // Clear per-column error state for this column
    setColumnErrors(prev => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

    // Invalidate validation and sync pipeline
    invalidateValidation();
    _afterCombineChange();
  }, [column]);

  // ── Detect if this column has a join pair (P5-S2, P5-S6) ────────────────
  // A column has a join pair when it is a physical column from the base table
  // and there exists a lookup whose first keyPair.left matches the column's
  // physical name. Solo columns (no join pair) do NOT show a gear icon.
  const colMap = buildColSourceMap();
  const colDef = column.getColDef();
  const headerField = colDef.field;
  const headerSource = headerField ? colMap.get(headerField) : undefined;
  const isPhysical = headerSource && headerSource.kind !== 'calc' && headerSource.kind !== 'band';
  const headerTableId = isPhysical ? (headerSource as { tid: string; col: string }).tid : undefined;
  const headerPhysCol = isPhysical ? (headerSource as { tid: string; col: string }).col : undefined;

  // Find a lookup where this column is the left key (base table → right table)
  let joinPairLookup: LookupSpec | null = null;
  let joinPairIdx = -1;
  if (isPhysical && headerTableId === state.base && headerPhysCol) {
    for (let i = 0; i < state.lookups.length; i++) {
      const lk = state.lookups[i];
      if (lk.keyPairs.length > 0 && lk.keyPairs[0].left === headerPhysCol) {
        joinPairLookup = lk;
        joinPairIdx = i;
        break;
      }
    }
  }

  /** Handle drag over: preventDefault to allow drop. */
  const handleDragOver = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /** Handle drop on top row (column chips / join keys).
   *
   * Parses the drop payload for { chipType, tableId, columnName }.
   * Only accepts chipType === 'column' drops.
   *
   * Three cases based on the header column's current source:
   * 1. Empty cell (no physical source): add column to report output
   * 2. Same sheet: replace the column chip
   * 3. Different sheet: create a join pair (LookupSpec)
   *
   * After mutation, calls invalidateValidation() and _afterCombineChange()
   * to sync the pipeline.
   */
  const handleTopRowDrop = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const data = parseDropData(e);
    if (!data) return;

    // Only accept column chips on the top row
    if (data.chipType !== 'column') return;

    const chipTableId = data.tableId as string;
    const chipColumnName = data.columnName as string;
    if (!chipTableId || !chipColumnName) return;

    const store = getStore();
    const colMap = buildColSourceMap();

    // Get the header column's field (alias) from AG Grid
    const colDef = column.getColDef();
    const headerField = colDef.field;
    if (!headerField) return;

    // Look up the header column's source in the column catalog
    const headerSource = colMap.get(headerField);

    // Determine if the source is a physical column (not calc, not band)
    const isPhysical = headerSource && headerSource.kind !== 'calc' && headerSource.kind !== 'band';
    const headerTableId = isPhysical ? headerSource.tid : undefined;
    const headerPhysCol = isPhysical ? headerSource.col : undefined;

    if (!headerTableId) {
      // ── P2-S2: Empty cell — add column to report output ──────────────
      store.update(draft => {
        // Set implicit base sheet if not yet set (DD design decision 11)
        if (!draft.base) {
          draft.base = chipTableId;
        }
        // Add the dropped column to selCols and colOrder
        (draft.selCols as Set<string>).add(chipColumnName);
        if (!draft.colOrder.includes(chipColumnName)) {
          draft.colOrder.push(chipColumnName);
        }
      });
    } else if (headerTableId === chipTableId) {
      // ── P2-S3: Same sheet — replace the column chip ──────────────────
      // Only act if the column name is actually different
      if (headerField !== chipColumnName) {
        store.update(draft => {
          // Remove old column from selCols and colOrder
          (draft.selCols as Set<string>).delete(headerField);
          const oldIdx = draft.colOrder.indexOf(headerField);
          if (oldIdx >= 0) draft.colOrder.splice(oldIdx, 1);

          // Add new column to selCols and colOrder
          (draft.selCols as Set<string>).add(chipColumnName);
          if (!draft.colOrder.includes(chipColumnName)) {
            draft.colOrder.push(chipColumnName);
          }
        });
      }
    } else {
      // ── P2-S4: Different sheet — create a join pair ──────────────────
      // The existing column (headerField) is the left side of the join key.
      // The dropped chip's column is the right side.
      const leftColName = headerPhysCol || headerField;

      store.update(draft => {
        // Create a new LookupSpec for the join
        const lookup: LookupSpec = {
          rightId: chipTableId,
          keyPairs: [{ left: leftColName, right: chipColumnName }],
          cols: [chipColumnName],
          required: false,       // left join by default
          enabled: true,
          duplicatePolicy: { mode: 'first' },
        };
        draft.lookups.push(lookup);

        // Ensure both columns are in selCols and colOrder
        (draft.selCols as Set<string>).add(headerField);
        if (!draft.colOrder.includes(headerField)) {
          draft.colOrder.push(headerField);
        }
        (draft.selCols as Set<string>).add(chipColumnName);
        if (!draft.colOrder.includes(chipColumnName)) {
          draft.colOrder.push(chipColumnName);
        }
      });
    }

    // P2-S5: Invalidate validation cache after store mutation
    invalidateValidation();

    // P2-S6: Notify pipeline that combine structure changed
    // (_afterCombineChange also calls invalidateValidation internally,
    // but we call it above for the non-combine paths too)
    _afterCombineChange();
  }, [column]);

  /** Handle drop on middle row (detail band sheet-name chips).
   *
   * Only accepts chipType === 'sheet' drops. Creates a new DetailBandSpec
   * with the dropped table as the child (rightId). Empty keyPairs and cols
   * are populated later via the band config modal.
   *
   * After mutation, calls invalidateValidation() directly (detail bands
   * do NOT use _afterCombineChange() per ui-layer.instructions.md).
   */
  const handleMiddleRowDrop = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const data = parseDropData(e);
    if (!data) return;

    // P3-S2: Only accept 'sheet' chip drops; reject column chips silently
    if (data.chipType !== 'sheet') return;

    const tableId = data.tableId as string;
    if (!tableId) return;

    const store = getStore();

    // P3-S4: Generate unique band ID
    const bandId = `band_${Date.now()}`;

    // P3-S3: Create a new DetailBandSpec and push to store
    const bandLabel = tableShortName(tableId);
    const newBand: DetailBandSpec = {
      id: bandId,
      rightId: tableId,
      keyPairs: [],
      cols: [],
      enabled: true,
      sorts: [],
      label: bandLabel,
    };

    store.update(draft => {
      draft.detailBands.push(newBand);
    });

    // P3-S7: Invalidate validation after store mutation
    // (Detail bands call invalidateValidation() directly, NOT _afterCombineChange())
    invalidateValidation();
  }, []);

  /** Handle drop on bottom row (extra match key chips).
   *
   * Parses the drop payload for { chipType: 'column', tableId, columnName }.
   * Finds the header column's source via buildColSourceMap(), then locates an
   * existing lookup where the header column's table is the base (left) side.
   * If found, adds { left: headerField, right: chipColumnName } as an extra
   * key pair to that lookup. The column is NOT added to report output (silent
   * join key per DD design decision 6).
   *
   * If no matching lookup exists, sets a red error state on the bottom row.
   *
   * After mutation, calls invalidateValidation() and _afterCombineChange()
   * since modifying lookup key pairs changes the join condition.
   */
  const handleBottomRowDrop = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const data = parseDropData(e);
    if (!data) return;

    // Only accept column chips on the bottom row
    if (data.chipType !== 'column') return;

    const chipTableId = data.tableId as string;
    const chipColumnName = data.columnName as string;
    if (!chipTableId || !chipColumnName) return;

    const store = getStore();
    const colMap = buildColSourceMap();

    // Get the header column's field (alias) from AG Grid
    const colDef = column.getColDef();
    const headerField = colDef.field;
    if (!headerField) return;

    // Look up the header column's source in the column catalog
    const headerSource = colMap.get(headerField);
    if (!headerSource || headerSource.kind === 'calc' || headerSource.kind === 'band') {
      // Header column has no physical source (calc/band) — can't be a join key
      setColumnErrors(prev => ({ ...prev, [headerField]: 'No physical source column for join key' }));
      return;
    }

    const headerTableId = headerSource.tid;

    // Find an existing lookup where the header column's table is the base side
    // and the chip's table is the right (joined) side.
    const currentState = store.getState();
    const lookupIdx = currentState.lookups.findIndex(
      lk => lk.rightId === chipTableId && headerTableId === currentState.base
    );

    if (lookupIdx < 0) {
      // P4-S5: No matching lookup exists — show red error state for this column
      setColumnErrors(prev => ({ ...prev, [headerField]: 'No matching lookup for this sheet pair' }));
      return;
    }

    // P4-S2: Add the extra key pair to the existing lookup
    store.update(draft => {
      draft.lookups[lookupIdx].keyPairs.push({
        left: headerField,
        right: chipColumnName,
      });
    });

    // Clear error state for this column on success
    setColumnErrors(prev => {
      if (!prev[headerField]) return prev;
      const next = { ...prev };
      delete next[headerField];
      return next;
    });

    // P4-S6: Invalidate validation after store mutation
    invalidateValidation();

    // Notify pipeline that combine structure changed (key pairs affect joins)
    _afterCombineChange();
  }, [column]);

  /** Handle label click: trigger AG Grid sort. */
  const handleLabelClick = useCallback((e: ReactMouseEvent) => {
    if (progressSort) {
      progressSort(e.shiftKey);
    }
  }, [progressSort]);

  // Per-column error message (if any) for this header column
  const columnErrorMsg = headerField ? columnErrors[headerField] : undefined;
  const hasColumnError = !!columnErrorMsg;

  return (
    <Tooltip title={columnErrorMsg || ''} open={hasColumnError ? undefined : false} arrow placement="bottom">
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          position: 'relative',
          // P7-S4: Red border/background when column has an error
          ...(hasColumnError ? {
            border: '1px solid rgba(255, 80, 80, 0.7)',
            backgroundColor: 'rgba(255, 0, 0, 0.08)',
            borderRadius: '3px',
          } : {}),
          // P7-S1: Show × button on hover
          '& .three-row-header-clear': {
            opacity: 0,
          },
          '&:hover .three-row-header-clear': {
            opacity: 1,
          },
        }}
        data-testid="three-row-header"
      >
        {/* P7-S1: × button — positioned in top-right corner, visible on hover */}
        <Box
          className="three-row-header-clear"
          component="button"
          type="button"
          onClick={handleClearColumn}
          sx={{
            position: 'absolute',
            top: 1,
            right: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 16,
            height: 16,
            border: 'none',
            background: 'rgba(255, 255, 255, 0.15)',
            color: 'inherit',
            fontSize: '12px',
            lineHeight: 1,
            cursor: 'pointer',
            borderRadius: '3px',
            p: 0,
            zIndex: 2,
            transition: 'opacity 0.15s ease',
            '&:hover': {
              background: 'rgba(255, 80, 80, 0.5)',
              color: '#fff',
            },
          }}
          title="Clear column"
        >
          {'\u00d7'}
        </Box>
      {/* Top row: column label / join key pairs / report column chips */}
      <Box
        sx={{
          height: ROW_HEIGHT,
          minHeight: ROW_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          gap: '3px',
          px: '4px',
          overflow: 'hidden',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
        data-row="top"
        onDragOver={handleDragOver}
        onDrop={handleTopRowDrop}
      >
        {color && (
          <Box
            sx={{
              width: 3,
              flexShrink: 0,
              alignSelf: 'stretch',
              background: color,
              borderRadius: '1px',
              mr: '2px',
            }}
          />
        )}
        {joinPairLookup && headerPhysCol ? (
          /* P5-S2, P5-S6: Render join key pair chips with gear icon */
          <JoinKeyPair
            leftCol={headerPhysCol}
            leftTableId={state.base}
            rightCol={joinPairLookup.keyPairs[0].right}
            rightTableId={joinPairLookup.rightId}
            lookupIndex={joinPairIdx}
            onGearClick={handleGearClick}
          />
        ) : (
          <Typography
            noWrap
            sx={{
              flex: 1,
              minWidth: 0,
              cursor: 'pointer',
              fontSize: 'inherit',
              fontWeight: 'inherit',
              lineHeight: 'inherit',
              color: 'inherit',
            }}
            onClick={handleLabelClick}
            title={displayLabel}
          >
            {displayLabel}
          </Typography>
        )}
      </Box>

      {/* Middle row: detail band sheet-name chips */}
      <Box
        sx={{
          height: ROW_HEIGHT,
          minHeight: ROW_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          px: '4px',
          overflow: 'hidden',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
        data-row="middle"
        onDragOver={handleDragOver}
        onDrop={handleMiddleRowDrop}
      >
        {state.detailBands.map(band => {
          const bandColor = getTableColor(band.rightId);
          const bandFg = chipFgColor(bandColor);
          return (
            <Box
              key={band.id}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '1px',
              }}
              data-band-id={band.id}
            >
              <ChipMUI
                label={band.label || tableShortName(band.rightId)}
                size="small"
                draggable={false}
                sx={{
                  height: 20,
                  fontSize: '0.65rem',
                  backgroundColor: bandColor,
                  color: bandFg,
                  borderLeft: `2px solid ${bandColor}`,
                  '& .MuiChip-label': { px: '4px' },
                }}
              />
              {/* Gear icon for band config */}
              <Box
                component="button"
                onClick={() => handleBandGearClick(band.id)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 16,
                  height: 18,
                  flexShrink: 0,
                  border: 'none',
                  background: 'transparent',
                  color: bandFg,
                  fontSize: '11px',
                  cursor: 'pointer',
                  borderRadius: '3px',
                  p: 0,
                  opacity: 0.7,
                  '&:hover': {
                    opacity: 1,
                    background: 'rgba(255,255,255,0.15)',
                  },
                }}
                title="Band configuration"
                type="button"
              >
                {'\u2699'}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Bottom row: extra match key chips */}
      <Box
        sx={{
          height: ROW_HEIGHT,
          minHeight: ROW_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          px: '4px',
          overflow: 'hidden',
        }}
        data-row="bottom"
        onDragOver={handleDragOver}
        onDrop={handleBottomRowDrop}
      />

      {/* P5-S3: Join options popup — rendered when gear icon is clicked */}
      {gearAnchor && gearLookupIdx >= 0 && gearLookupIdx < state.lookups.length && (
        <JoinOptionsPopup
          open={!!gearAnchor}
          anchorEl={gearAnchor}
          onClose={handleGearClose}
          lookup={state.lookups[gearLookupIdx]}
          lookupIndex={gearLookupIdx}
        />
      )}

      {/* P6-S5: Band config modal — rendered when gear icon on band chip is clicked */}
      <BandConfigModal
        open={bandConfigId !== null}
        bandId={bandConfigId}
        onClose={handleBandConfigClose}
      />
    </Box>
    </Tooltip>
  );
}
