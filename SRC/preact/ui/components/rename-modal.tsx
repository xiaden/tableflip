import { useState, useEffect, useRef } from 'preact/hooks';
import { getStore } from '../../core/store';
import { setColLabel } from '../../core/utils';
import { buildColSourceMap } from '../../catalog/column-catalog';
import { _renameProjectedAliasRefs } from '../../query/alias-ref-updater';
import { Modal } from './modal';

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

export interface RenameModalProps {
  target: RenameTarget;
  onDone?: () => void;
  onClose: () => void;
}

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
        const calcStages = getStore().getState().calcStages;
        const calc = Array.isArray(calcStages) ? calcStages[target.calcIdx!] : null;
        if (calc) {
          getStore().update(draft => {
            if (draft.calcStages[target.calcIdx!]) {
              draft.calcStages[target.calcIdx!].alias = newName;
            }
          });
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
