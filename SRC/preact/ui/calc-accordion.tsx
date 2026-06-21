/**
 * CalcAccordion — calculated columns accordion for the right sidebar.
 *
 * Renders a collapsible MUI Accordion containing:
 * - A dashed-border "+ add calculation" chip that opens a CalcBuilder dialog
 * - One Chip per existing CalcStage entry with context menu (Rename, Edit) and remove button
 *
 * The CalcBuilder dialog manages a local CalcStage draft. On Create/Save the draft
 * is pushed to (or replaces an entry in) store.calcStages via store.update().
 */

import { useState, useCallback, useMemo } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import ChipMUI from '@mui/material/Chip';
import { getStore } from '../core/store';
import { toast } from '../core/utils';
import { invalidateValidation } from '../report/validation';
import { _afterCombineChange } from '../query/layout-selection';
import { useStore } from './useStore';
import { Chip } from './components/chip';
import { ContextMenu } from './components/context-menu';
import type { CtxMenuItem } from './components/context-menu';
import { RenameModal, resolveRenameTarget } from './components/rename-modal';
import type { RenameTarget } from './components/rename-modal';
import {
  calcModeComponents,
  type CalcBuilderProps,
  type ColOption,
} from './components/calc-builder';
import type { CalcMode, CalcStage, DbTable } from '../types';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Create a default CalcStage for the given mode with sensible initial config. */
function createDefaultCalc(mode: CalcMode, alias: string): CalcStage {
  const base: CalcStage = { alias, mode, enabled: true };
  switch (mode) {
    case 'math':
      base.math = { strategy: 'stepChain', steps: [{ type: 'column', value: '' }] };
      break;
    case 'text':
      base.text = { operation: 'combine', parts: [{ type: 'column', value: '' }] };
      break;
    case 'compare':
      base.compare = {
        compareMode: 'AND',
        conditions: [{ col: '', op: '=', val: '' }],
        trueValue: { type: 'number', value: '1' },
        falseValue: { type: 'number', value: '0' },
      };
      break;
    case 'date':
      base.date = {
        operation: 'extract',
        source: { type: 'column', value: '' },
        part: 'year',
        output: 'number',
      };
      break;
  }
  return base;
}

/** Collect all column names from all loaded tables. */
function buildColList(tables: Record<string, DbTable>): string[] {
  const seen = new Set<string>();
  const cols: string[] = [];
  for (const tbl of Object.values(tables)) {
    for (const c of tbl.cols) {
      if (!seen.has(c)) {
        seen.add(c);
        cols.push(c);
      }
    }
  }
  return cols;
}

/** Build ColOption[] for a given selection value from a flat column list. */
function buildColOpts(sel: string, allCols: string[]): ColOption[] {
  return allCols.map(c => ({ value: c, label: c, selected: c === sel }));
}

/** Calc mode labels for the mode selector in the dialog. */
const CALC_MODES: Array<{ value: CalcMode; label: string }> = [
  { value: 'math', label: 'Math' },
  { value: 'text', label: 'Text' },
  { value: 'compare', label: 'Compare' },
  { value: 'date', label: 'Date' },
];

// ── Prop-change mutators ───────────────────────────────────────────────────────

/**
 * Apply a top-level prop change to a CalcStage draft.
 * Handles the various pseudo-properties the CalcBuilder emits (mathOp, compareMode,
 * dateOperation, dateSource, textOperation, etc.) and maps them to the correct
 * nested location in the CalcStage structure.
 */
function applyPropChange(calc: CalcStage, prop: string, val: string): void {
  switch (prop) {
    // Math mode
    case 'mathOp':
      (calc as Record<string, unknown>).mathOp = val;
      break;
    case 'window':
      (calc as Record<string, unknown>).window = val;
      break;

    // Compare mode
    case 'compareMode': {
      const cmp = (calc.compare ??= {}) as Record<string, unknown>;
      cmp.compareMode = val;
      break;
    }

    // Text mode
    case 'textOperation': {
      const txt = (calc.text ??= {}) as Record<string, unknown>;
      txt.operation = val;
      break;
    }
    case 'textSource': {
      const txt = (calc.text ??= {}) as Record<string, unknown>;
      txt.source = { type: 'column', value: val };
      break;
    }
    case 'textCount': {
      const txt = (calc.text ??= {}) as Record<string, unknown>;
      txt.count = parseInt(val, 10) || 1;
      break;
    }
    case 'textStart': {
      const txt = (calc.text ??= {}) as Record<string, unknown>;
      txt.start = parseInt(val, 10) || 1;
      break;
    }
    case 'textLength': {
      const txt = (calc.text ??= {}) as Record<string, unknown>;
      txt.length = parseInt(val, 10) || 1;
      break;
    }

    // Date mode
    case 'dateOperation': {
      const d = (calc.date ??= {}) as Record<string, unknown>;
      d.operation = val;
      break;
    }
    case 'dateSource': {
      const d = (calc.date ??= {}) as Record<string, unknown>;
      d.source = { type: 'column', value: val };
      break;
    }
    case 'dateSource2': {
      const d = (calc.date ??= {}) as Record<string, unknown>;
      d.source2 = { type: 'column', value: val };
      break;
    }
    case 'datePart': {
      const d = (calc.date ??= {}) as Record<string, unknown>;
      d.part = val;
      break;
    }
    case 'dateOutput': {
      const d = (calc.date ??= {}) as Record<string, unknown>;
      d.output = val;
      break;
    }
    case 'dateFmtFirst': {
      const d = (calc.date ??= {}) as Record<string, unknown>;
      const fmt = (d.inputFormat ??= {}) as Record<string, unknown>;
      fmt.first = val;
      break;
    }
    case 'dateFmtSecond': {
      const d = (calc.date ??= {}) as Record<string, unknown>;
      const fmt = (d.inputFormat ??= {}) as Record<string, unknown>;
      fmt.second = val;
      break;
    }
    case 'dateFmtThird': {
      const d = (calc.date ??= {}) as Record<string, unknown>;
      const fmt = (d.inputFormat ??= {}) as Record<string, unknown>;
      fmt.third = val;
      break;
    }
    case 'dateUnit': {
      const d = (calc.date ??= {}) as Record<string, unknown>;
      d.unit = val;
      break;
    }
    case 'dateOperandType': {
      const d = (calc.date ??= {}) as Record<string, unknown>;
      const operand = (d.operand ??= {}) as Record<string, unknown>;
      operand.type = val;
      break;
    }
    case 'dateOperandValue': {
      const d = (calc.date ??= {}) as Record<string, unknown>;
      const operand = (d.operand ??= {}) as Record<string, unknown>;
      operand.value = val;
      break;
    }
  }
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

// ── Component ──────────────────────────────────────────────────────────────────

export function CalcAccordion() {
  const calcStages = useStore(s => s.calcStages);
  const tables = useStore(s => s.tables);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [localCalc, setLocalCalc] = useState<CalcStage | null>(null);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; index: number } | null>(null);

  // Rename modal state
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  // All columns from all tables (memoized)
  const allCols = useMemo(() => buildColList(tables), [tables]);
  const colOptsFor = useCallback((sel: string): ColOption[] => buildColOpts(sel, allCols), [allCols]);

  // ── Dialog open/close ──────────────────────────────────────────────────────

  const openNewDialog = () => {
    const alias = `calc_${Date.now()}`;
    setLocalCalc(createDefaultCalc('math', alias));
    setEditingIndex(null);
    setDialogOpen(true);
  };

  const openEditDialog = (idx: number) => {
    const existing = getStore().getState().calcStages[idx];
    if (!existing) return;
    setLocalCalc(structuredClone(existing));
    setEditingIndex(idx);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingIndex(null);
    setLocalCalc(null);
  };

  // ── Mode change ────────────────────────────────────────────────────────────

  const handleModeChange = (newMode: CalcMode) => {
    if (!localCalc) return;
    const alias = localCalc.alias;
    const fresh = createDefaultCalc(newMode, alias);
    setLocalCalc(fresh);
  };

  // ── Prop change callbacks for CalcBuilder ──────────────────────────────────

  const handlePropChange = useCallback((prop: string, val: string) => {
    setLocalCalc(prev => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      applyPropChange(next, prop, val);
      return next;
    });
  }, []);

  const handleCondChange = useCallback((j: number, prop: string, val: string) => {
    setLocalCalc(prev => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      const cmp = (next.compare ??= {}) as Record<string, unknown>;
      const conds = (cmp.conditions ??= []) as Array<Record<string, unknown>>;
      if (conds[j]) conds[j][prop] = val;
      return next;
    });
  }, []);

  const handleTextPartChange = useCallback((j: number, prop: string, val: string) => {
    setLocalCalc(prev => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      const txt = (next.text ??= {}) as Record<string, unknown>;
      const parts = (txt.parts ??= []) as Array<Record<string, unknown>>;
      if (parts[j]) parts[j][prop] = val;
      return next;
    });
  }, []);

  const handleTextAddPart = useCallback(() => {
    setLocalCalc(prev => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      const txt = (next.text ??= {}) as Record<string, unknown>;
      const parts = (txt.parts ??= []) as Array<Record<string, unknown>>;
      parts.push({ type: 'column', value: '' });
      return next;
    });
  }, []);

  const handleTextRemovePart = useCallback((j: number) => {
    setLocalCalc(prev => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      const txt = (next.text ??= {}) as Record<string, unknown>;
      const parts = (txt.parts ??= []) as Array<Record<string, unknown>>;
      if (parts.length > 1) parts.splice(j, 1);
      return next;
    });
  }, []);

  const handleMathStepChange = useCallback((stepIdx: number, prop: string, val: string) => {
    setLocalCalc(prev => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      const m = (next.math ??= {}) as Record<string, unknown>;
      const steps = (m.steps ??= []) as Array<Record<string, unknown>>;
      if (steps[stepIdx]) steps[stepIdx][prop] = val;
      return next;
    });
  }, []);

  const handleMathAddStep = useCallback(() => {
    setLocalCalc(prev => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      const m = (next.math ??= {}) as Record<string, unknown>;
      const steps = (m.steps ??= []) as Array<Record<string, unknown>>;
      steps.push({ type: 'column', value: '', op: '+' });
      return next;
    });
  }, []);

  const handleMathRemoveStep = useCallback((stepIdx: number) => {
    setLocalCalc(prev => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      const m = (next.math ??= {}) as Record<string, unknown>;
      const steps = (m.steps ??= []) as Array<Record<string, unknown>>;
      if (steps.length > 1) steps.splice(stepIdx, 1);
      return next;
    });
  }, []);

  // ── Create / Save ──────────────────────────────────────────────────────────

  const handleCreate = () => {
    if (!localCalc) return;
    const calc = structuredClone(localCalc);
    const isEdit = editingIndex != null;

    getStore().update(draft => {
      if (isEdit) {
        draft.calcStages[editingIndex!] = calc;
      } else {
        draft.calcStages.push(calc);
      }
    });

    invalidateValidation();
    _afterCombineChange();
    toast(`${isEdit ? 'Updated' : 'Created'} calculation "${calc.alias}"`, 'ok');
    closeDialog();
  };

  // ── Remove calc ────────────────────────────────────────────────────────────

  const removeCalc = (idx: number) => {
    const alias = getStore().getState().calcStages[idx]?.alias || '';
    getStore().update(draft => {
      draft.calcStages.splice(idx, 1);
    });
    invalidateValidation();
    _afterCombineChange();
    toast(`Removed calculation "${alias}"`, 'ok');
  };

  // ── Context menu ───────────────────────────────────────────────────────────

  const handleCalcContextMenu = (e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, index: idx });
  };

  const ctxMenuItems: CtxMenuItem[] | null = ctxMenu ? [
    { label: 'Rename', action: () => {
      const calc = getStore().getState().calcStages[ctxMenu.index];
      if (calc) {
        const target = resolveRenameTarget(calc.alias);
        if (target) setRenameTarget(target);
      }
    }},
    { label: 'Edit...', action: () => {
      openEditDialog(ctxMenu.index);
    }},
    { separator: true },
    { label: 'Remove', action: () => {
      removeCalc(ctxMenu.index);
    }},
  ] : null;

  // ── CalcBuilder component for current mode ─────────────────────────────────

  const renderCalcBuilder = () => {
    if (!localCalc) return null;
    const ModeComponent = calcModeComponents[localCalc.mode];
    if (!ModeComponent) return null;

    const builderProps: CalcBuilderProps = {
      calc: localCalc,
      i: editingIndex ?? 0,
      cols: allCols,
      colOptsFor,
      onPropChange: handlePropChange,
      onCondChange: handleCondChange,
      onTextPartChange: handleTextPartChange,
      onTextAddPart: handleTextAddPart,
      onTextRemovePart: handleTextRemovePart,
      onMathStepChange: handleMathStepChange,
      onMathAddStep: handleMathAddStep,
      onMathRemoveStep: handleMathRemoveStep,
    };

    return <ModeComponent {...builderProps} />;
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Accordion disableGutters defaultExpanded sx={{ '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandChevron />} sx={{ minHeight: 40, px: 1 }}>
          <Typography variant="body2" sx={{ fontSize: '0.82rem', fontWeight: 600 }}>
            Calculated Columns
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 1, py: 0.75, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {/* + add calculation chip */}
          <Box
            onClick={openNewDialog}
            sx={{
              border: '1px dashed var(--border)',
              borderRadius: '16px',
              px: 1.5,
              py: 0.25,
              fontSize: '0.75rem',
              color: 'text.secondary',
              cursor: 'pointer',
              textAlign: 'center',
              '&:hover': { borderColor: 'primary.main', color: 'primary.main' },
              userSelect: 'none',
            }}
          >
            + add calculation
          </Box>

          {/* existing calc chips */}
          {calcStages.map((calc, idx) => (
            <Box key={`${calc.alias}-${idx}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Chip
                col={calc.alias}
                label={calc.alias}
                draggable={false}
                onContextMenu={(e) => handleCalcContextMenu(e, idx)}
              />
              <ChipMUI
                label="×"
                size="small"
                onClick={() => removeCalc(idx)}
                sx={{
                  fontSize: '0.7rem',
                  minWidth: 20,
                  height: 20,
                  borderRadius: '50%',
                  '& .MuiChip-label': { px: 0.5 },
                }}
              />
            </Box>
          ))}
        </AccordionDetails>
      </Accordion>

      {/* CalcBuilder Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        aria-modal="true"
        slotProps={{
          paper: {
            sx: {
              minWidth: 380,
              maxWidth: 520,
              fontSize: '0.85rem',
            },
          },
        }}
      >
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600, pb: 1 }}>
          {editingIndex != null ? 'Edit Calculation' : 'New Calculation'}
        </DialogTitle>
        <DialogContent sx={{ mb: 2 }}>
          {/* Mode selector */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Typography variant="body2" sx={{ fontSize: '0.78rem' }}>Mode</Typography>
            <FormControl size="small">
              <Select
                value={localCalc?.mode || 'math'}
                onChange={e => handleModeChange(e.target.value as CalcMode)}
                sx={{ width: 120 }}
              >
                {CALC_MODES.map(m => (
                  <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {/* Alias input */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Typography variant="body2" sx={{ fontSize: '0.78rem' }}>Alias</Typography>
            <input
              type="text"
              value={localCalc?.alias || ''}
              onChange={e => setLocalCalc(prev => prev ? { ...prev, alias: e.target.value } : prev)}
              style={{
                fontSize: '0.82rem',
                padding: '4px 8px',
                border: '1px solid var(--border)',
                borderRadius: 4,
                width: 200,
              }}
            />
          </Box>

          {/* Mode-specific builder */}
          {renderCalcBuilder()}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button variant="outlined" size="small" onClick={closeDialog}>
            Cancel
          </Button>
          <Button variant="contained" size="small" onClick={handleCreate} autoFocus>
            {editingIndex != null ? 'Save' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Context menu */}
      {ctxMenu && ctxMenuItems && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenuItems}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Rename modal */}
      {renameTarget && (
        <RenameModal
          target={renameTarget}
          onClose={() => setRenameTarget(null)}
          onDone={() => {
            invalidateValidation();
            _afterCombineChange();
          }}
        />
      )}
    </>
  );
}
