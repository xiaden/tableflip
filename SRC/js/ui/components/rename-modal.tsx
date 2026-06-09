import { useState, useEffect, useRef } from 'preact/hooks';
import { db } from '../../core/state.js';
import { setColLabel } from '../../core/utils.js';
import { buildColSourceMap } from '../../catalog/column-catalog.js';
import { _renameProjectedAliasRefs } from '../../query/alias-ref-updater.js';
import { Modal } from './modal.js';

export interface RenameTarget {
  alias: string;
  tid?: string;
  col?: string;
  calcIdx?: number;
}

export function resolveRenameTarget(alias: string): RenameTarget | null {
  const colMap = buildColSourceMap();
  const src = colMap.get(alias);
  if (!src) return null;
  if (src.kind === 'calc') return { alias, calcIdx: src.idx };
  return { alias, tid: src.tid, col: src.col };
}

export function renameSourceCol(tid: string, col: string, onDone?: () => void): void {
  const colMap = buildColSourceMap();
  for (const [alias, src] of colMap.entries()) {
    if (src.kind !== 'calc' && src.tid === tid && src.col === col) {
      // Sets target externally — caller should manage state
      onDone?.();
      return;
    }
  }
}

export interface RenameModalProps {
  target: RenameTarget;
  onDone?: () => void;
  onClose: () => void;
}

export function RenameModal({ target, onDone, onClose }: RenameModalProps) {
  const isCalc = target.calcIdx != null;
  const current = isCalc
    ? ((Array.isArray(db.calcStages) ? db.calcStages[target.calcIdx!]?.alias : '') || '').trim() || target.alias
    : db.columnLabels?.[target.tid!]?.[target.col!] || '';

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
        const calc = Array.isArray(db.calcStages) ? db.calcStages[target.calcIdx!] : null;
        if (calc) {
          calc.alias = newName;
          _renameProjectedAliasRefs(current, newName);
        }
      }
    } else {
      setColLabel(target.tid!, target.col!, newName);
    }
    onClose();
    onDone?.();
  };

  const handleKey = (e: KeyboardEvent) => {
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
      <label for="rename-input" style="font-size:0.78rem;color:var(--muted)">Current name</label>
      <input
        ref={inputRef}
        id="rename-input"
        type="text"
        class="rename-modal-input"
        value={value}
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        onKeyDown={handleKey}
      />
    </Modal>
  );
}
