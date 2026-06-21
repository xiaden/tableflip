/**
 * SheetAccordions — per-sheet MUI Accordions for the right sidebar.
 *
 * Renders one Accordion per imported sheet (physical tables from state.tables).
 * Stacked virtual sheets (state.stacks entries) appear as separate accordions
 * with visual distinction per DD design decision 12.
 *
 * Each accordion header shows:
 * 1. A draggable sheet-name chip (chipType: 'sheet') using the existing Chip component
 * 2. Row count display (e.g., "(1,234 rows)")
 * 3. Remove button (x) that calls dropTable() + thorough store cleanup
 *
 * When expanded, the accordion details area shows draggable column chips
 * (chipType: 'column') color-coded by table. Right-click on a column chip
 * opens a context menu with: Type override (string/number/date/boolean),
 * Rename (via RenameModal), and Merge toggle.
 *
 * Uses MUI Accordion with default 48px headers per DD design decision 2.
 */

import { useState, useCallback } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import { useStore } from './useStore';
import { Chip } from './components/chip';
import { ContextMenu } from './components/context-menu';
import type { CtxMenuItem } from './components/context-menu';
import { RenameModal, resolveRenameTarget } from './components/rename-modal';
import type { RenameTarget } from './components/rename-modal';
import { getStore } from '../core/store';
import { tableShortName, getTableColorClass } from '../core/utils';
import { dropTable } from '../core/sqldb';
import { invalidateValidation } from '../report/validation';
import type { DbTable, ColumnType } from '../types';

/**
 * Format a row count with locale-aware comma separators.
 * Guards against non-finite values.
 */
function formatRowCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US');
}

/**
 * Remove a table from the SQL database and clean up all state references.
 *
 * Thoroughly removes the table ID from:
 * - state.tables (the DbTable entry)
 * - state.tableColors (color assignment)
 * - state.columnLabels (per-column display labels)
 * - state.columnTypeOverrides (per-column type overrides)
 * - state.excludedRows (excluded row indices)
 * - state.stacks (if present as a stacked virtual sheet)
 * - state.stackAliases (if present as a stack alias)
 * - state.base (if this was the base table — clears base + baseCols)
 * - state.lookups (any lookup referencing this table as rightId)
 * - state.detailBands (any band referencing this table as rightId)
 *
 * Calls invalidateValidation() so the next validation pass recomputes.
 */
function removeTable(tableId: string): void {
  // Drop the SQL table (silently ignores if not found)
  dropTable(tableId);

  // Clean up all state references via store.update()
  getStore().update(draft => {
    // Remove the table entry itself
    delete draft.tables[tableId];

    // Remove color assignment
    delete draft.tableColors[tableId];

    // Remove column display labels
    delete draft.columnLabels[tableId];

    // Remove column type overrides
    delete draft.columnTypeOverrides[tableId];

    // Remove excluded rows
    delete draft.excludedRows[tableId];

    // Remove from stacks array if present
    const stackIdx = draft.stacks.indexOf(tableId);
    if (stackIdx >= 0) draft.stacks.splice(stackIdx, 1);

    // Remove from stackAliases if present
    if (draft.stackAliases[tableId]) {
      delete draft.stackAliases[tableId];
    }

    // Clear base table if this was the base
    if (draft.base === tableId) {
      draft.base = '';
      draft.baseCols = [];
    }

    // Remove lookups referencing this table as the right (joined) table
    draft.lookups = draft.lookups.filter(l => l.rightId !== tableId);

    // Remove detail bands referencing this table as the child table
    draft.detailBands = draft.detailBands.filter(b => b.rightId !== tableId);
  });

  // Invalidate validation cache so next check recomputes
  invalidateValidation();
}

/**
 * Inline SVG chevron for the accordion expand indicator.
 * Points down when collapsed, rotates 180deg to point up when expanded
 * (MUI AccordionSummary handles the rotation automatically).
 */
function ExpandChevron() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/**
 * SheetAccordions — renders one MUI Accordion per imported sheet.
 *
 * Subscribes to store.tables, store.stacks, and store.stackAliases
 * via useStore for reactive updates when sheets change.
 *
 * Stacked virtual sheets (table IDs in state.stacks) get a subtle
 * visual distinction: tinted background + left accent border + italic
 * "stack" label next to the sheet chip.
 */
export function SheetAccordions() {
  // Reactive subscriptions — component re-renders when these slices change
  const tables = useStore(s => s.tables);
  const stacks = useStore(s => s.stacks);
  const columnTypeOverrides = useStore(s => s.columnTypeOverrides);
  const mergedCols = useStore(s => s.mergedCols);

  // Context menu state for column chips
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; tableId: string; colName: string;
  } | null>(null);

  // Rename modal state for column chips
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  // Build a Set for O(1) stack membership checks
  const stackSet = new Set(stacks);

  // Derive the ordered list of table entries to render
  const tableEntries = Object.values(tables);

  /**
   * Handle drag start on a sheet-name chip.
   * Sets the drag payload as JSON with chipType 'sheet' and the table ID.
   */
  const handleDragStart = useCallback((e: React.DragEvent, tableId: string) => {
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({ chipType: 'sheet', tableId }),
    );
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  /**
   * Handle remove button click.
   * Stops propagation to prevent toggling the accordion, then removes the table.
   */
  const handleRemove = useCallback((e: React.MouseEvent, tableId: string) => {
    e.stopPropagation(); // Prevent accordion expand/collapse toggle
    removeTable(tableId);
  }, []);

  /**
   * Handle drag start on a column chip.
   * Sets the drag payload as JSON with chipType 'column', tableId, and columnName.
   */
  const handleColDragStart = useCallback((e: React.DragEvent, tableId: string, colName: string) => {
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({ chipType: 'column', tableId, columnName: colName }),
    );
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  /**
   * Handle right-click on a column chip — opens the context menu.
   */
  const handleColContextMenu = useCallback((e: React.MouseEvent, tableId: string, colName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, tableId, colName });
  }, []);

  /**
   * Set a column type override for a specific table column.
   * Writes to store.columnTypeOverrides[tableId][colName] and invalidates validation.
   */
  const handleTypeOverride = useCallback((tableId: string, colName: string, selectedType: ColumnType) => {
    getStore().update(draft => {
      if (!draft.columnTypeOverrides[tableId]) {
        draft.columnTypeOverrides[tableId] = {};
      }
      draft.columnTypeOverrides[tableId][colName] = selectedType;
    });
    invalidateValidation();
  }, []);

  /**
   * Open the rename modal for a column chip.
   * Uses resolveRenameTarget to look up the column in the column source map.
   */
  const handleRename = useCallback((colName: string) => {
    const target = resolveRenameTarget(colName);
    if (target) {
      setRenameTarget(target);
    }
  }, []);

  /**
   * Toggle a column in store.mergedCols (add if absent, remove if present).
   */
  const handleMergeToggle = useCallback((colName: string) => {
    getStore().update(draft => {
      const idx = draft.mergedCols.indexOf(colName);
      if (idx >= 0) {
        draft.mergedCols.splice(idx, 1);
      } else {
        draft.mergedCols.push(colName);
      }
    });
  }, []);

  /**
   * Build context menu items for the currently right-clicked column chip.
   * Includes: type radio items (string/number/date/boolean), Rename, Merge toggle.
   */
  const buildCtxMenuItems = useCallback((): CtxMenuItem[] | null => {
    if (!contextMenu) return null;
    const { tableId, colName } = contextMenu;
    const currentType = columnTypeOverrides[tableId]?.[colName] as ColumnType | undefined;
    const isMerged = mergedCols.includes(colName);

    const types: ColumnType[] = ['string', 'number', 'date', 'boolean'];
    const typeItems: CtxMenuItem[] = types.map(t => ({
      label: t,
      checked: currentType === t,
      action: () => handleTypeOverride(tableId, colName, t),
    }));

    return [
      ...typeItems,
      { separator: true },
      { label: 'Rename', action: () => handleRename(colName) },
      { separator: true },
      { label: 'Merge', checked: isMerged, action: () => handleMergeToggle(colName) },
    ];
  }, [contextMenu, columnTypeOverrides, mergedCols, handleTypeOverride, handleRename, handleMergeToggle]);

  // Empty state: no sheets imported
  if (tableEntries.length === 0) {
    return (
      <Box sx={{ p: 1 }}>
        <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
          No sheets imported
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <Box sx={{ overflowY: 'auto', flex: 1 }}>
        {tableEntries.map((table: DbTable) => {
        const isStack = stackSet.has(table.id);
        const colorClass = getTableColorClass(table.id);
        const shortName = tableShortName(table.id);

        return (
          <Accordion
            key={table.id}
            disableGutters
            sx={{
              // Remove the default ::before divider between accordions
              '&:before': { display: 'none' },
              // Visual distinction for stacked virtual sheets (DD decision 12)
              ...(isStack && {
                backgroundColor: 'rgba(88,166,255,0.04)',
                borderLeft: '2px solid var(--accent)',
              }),
            }}
          >
            <AccordionSummary
              expandIcon={
                <Box
                  component="span"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    color: 'var(--muted)',
                  }}
                >
                  <ExpandChevron />
                </Box>
              }
              sx={{
                minHeight: 48,
                px: 1,
                '& .MuiAccordionSummary-content': {
                  alignItems: 'center',
                  gap: 0.5,
                  my: 0.5,
                },
              }}
            >
              {/* Sheet-name chip — draggable for band drops */}
              <Chip
                col={table.id}
                label={shortName}
                colorClass={colorClass}
                draggable
                chipClass="chip"
                onDragStart={(e) => handleDragStart(e, table.id)}
              />

              {/* Stack indicator for virtual sheets */}
              {isStack && (
                <Typography
                  variant="caption"
                  sx={{
                    color: 'var(--accent)',
                    fontStyle: 'italic',
                    ml: 0.25,
                    whiteSpace: 'nowrap',
                  }}
                >
                  stack
                </Typography>
              )}

              {/* Row count — pushed to the right */}
              <Typography
                variant="caption"
                sx={{
                  color: 'var(--muted)',
                  ml: 'auto',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                ({formatRowCount(table.rowCount)} rows)
              </Typography>

              {/* Remove button */}
              <IconButton
                size="small"
                sx={{
                  p: 0.25,
                  color: 'var(--muted)',
                  '&:hover': { color: 'var(--red)' },
                  flexShrink: 0,
                }}
                onClick={(e) => handleRemove(e, table.id)}
                title="Remove sheet"
              >
                <Typography
                  component="span"
                  sx={{ fontSize: '0.9rem', lineHeight: 1 }}
                >
                  ×
                </Typography>
              </IconButton>
            </AccordionSummary>

            <AccordionDetails sx={{ px: 1, py: 0.5 }}>
              {/* Draggable column chips — color-coded by table, with right-click context menu */}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {table.cols.map((colName: string) => (
                  <Chip
                    key={colName}
                    col={colName}
                    label={colName}
                    colorClass={colorClass}
                    draggable
                    chipClass="chip"
                    onDragStart={(e) => handleColDragStart(e, table.id, colName)}
                    onContextMenu={(e) => handleColContextMenu(e, table.id, colName)}
                  />
                ))}
              </Box>
            </AccordionDetails>
          </Accordion>
        );
      })}
      </Box>

      {/* Column chip context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildCtxMenuItems() || []}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Column rename modal */}
      {renameTarget && (
        <RenameModal
          target={renameTarget}
          onClose={() => setRenameTarget(null)}
          onDone={() => invalidateValidation()}
        />
      )}
    </>
  );
}
