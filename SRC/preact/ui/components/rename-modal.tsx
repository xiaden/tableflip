import { useState, useEffect, useRef } from 'react';
import TextField from '@mui/material/TextField';
import { getStore } from '../../core/store';
import { setColLabel } from '../../core/utils';
import { buildColSourceMap } from '../../catalog/column-catalog';
import { renameCalcAlias } from '../../core/alias-rename';
import { Modal } from './modal';

/** Identifies the column being renamed. Either a calculated column (by calcIdx) or a physical column (by tid + col). */
export interface RenameTarget {
  /** The current alias/name of the column. */
  alias: string;
  /** Table ID for physical columns. */
  tid?: string;
  /** Column name within the table for physical columns. */
  col?: string;
  /** Index into calcStages for calculated columns. */
  calcIdx?: number;
}

export function resolveRenameTarget(alias: string): RenameTarget | null {
  const colMap = buildColSourceMap();
  const src = colMap.get(alias);
  if (!src) return null;
  if (src.kind === 'calc') return { alias, calcIdx: src.idx };
  return { alias, tid: src.tid, col: src.col };
}

export interface RenameModalProps {
  target: RenameTarget;
  onDone?: () => void;
  onClose: () => void;
}

/**
 * Modal dialog for renaming a column.
 *
 * Handles two rename paths: calculated columns (identified by calcIdx) are renamed
 * via renameCalcAlias, while physical columns (identified by tid + col) are renamed
 * via setColLabel. The input is pre-filled with the current name and auto-focused
 * with text selected. Supports Enter key to confirm.
 */
export function RenameModal({ target, onDone, onClose }: RenameModalProps) {
  const isCalc = target.calcIdx != null;
  const state = getStore().getState();
  const current = isCalc
    ? ((Array.isArray(state.calcStages) ? state.calcStages[target.calcIdx!]?.alias : '') || '').trim() || target.alias
    : state.columnLabels?.[target.tid!]?.[target.col!] || '';

  const [value, setValue] = useState(current || target.alias);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const inp = inputRef.current;
    if (inp) { inp.focus(); inp.select(); }
  }, []);

  const handleRename = () => {
    const newName = value.trim();
    if (isCalc) {
      if (newName && newName !== current) {
        renameCalcAlias(target.calcIdx!, newName);
      }
    } else {
      setColLabel(target.tid!, target.col!, newName);
    }
    onClose();
    onDone?.();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleRename(); }
  };

  return (
    <Modal
      open={true}
      title="Rename column"
      onClose={onClose}
      buttons={[
        { label: 'Cancel', action: onClose },
        { label: 'Rename', primary: true, action: handleRename },
      ]}
    >
      <TextField
        inputRef={inputRef}
        id="rename-input"
        label="Current name"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        size="small"
        fullWidth
        autoFocus
        sx={{ mt: 1, '& .MuiInputLabel-root': { fontSize: '0.78rem' } }}
      />
    </Modal>
  );
}
