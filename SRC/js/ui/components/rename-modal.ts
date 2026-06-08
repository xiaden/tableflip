import { db } from '../../core/state.js';
import { h, setColLabel } from '../../core/utils.js';
import { buildColSourceMap } from '../../catalog/column-catalog.js';
import { _renameProjectedAliasRefs } from '../../query/alias-ref-updater.js';
import { showModal, closeModal } from './modal.js';

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

  if (src.kind === 'calc') {
    return { alias, calcIdx: src.idx };
  }
  return { alias, tid: src.tid, col: src.col };
}

export function renameSourceCol(tid: string, col: string, onDone?: () => void): void {
  const colMap = buildColSourceMap();
  for (const [alias, src] of colMap.entries()) {
    if (src.kind !== 'calc' && src.tid === tid && src.col === col) {
      showRenameModal({ alias, tid, col }, onDone);
      return;
    }
  }
}

export function showRenameModal(target: RenameTarget, onDone?: () => void): void {
  const isCalc = target.calcIdx != null;
  let current: string;

  if (isCalc) {
    const calc = Array.isArray(db.calcStages) ? db.calcStages[target.calcIdx!] : null;
    current = ((calc?.alias) || '').trim() || target.alias;
  } else {
    current = db.columnLabels?.[target.tid!]?.[target.col!] || '';
  }

  const inputId = 'renameInput-' + Date.now();

  showModal({
    title: 'Rename column',
    content: `<label for="${inputId}" style="font-size:0.78rem;color:var(--muted)">Current name</label>
      <input type="text" id="${inputId}" class="rename-modal-input" value="${h(current || target.alias)}">`,
    buttons: [
      {
        label: 'Cancel',
        action: () => closeModal(),
      },
      {
        label: 'Rename',
        primary: true,
        action: () => {
          const inp = document.getElementById(inputId) as HTMLInputElement | null;
          if (!inp) { closeModal(); return; }
          const newName = inp.value.trim();
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
          closeModal();
          onDone?.();
        },
      },
    ],
    closeOnBackdrop: true,
    onClose: () => {},
  });

  requestAnimationFrame(() => {
    const inp = document.getElementById(inputId) as HTMLInputElement | null;
    if (inp) {
      inp.focus();
      inp.select();
      inp.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const btn = inp.closest('.modal-content')?.querySelector('.btn-primary') as HTMLElement | null;
          btn?.click();
        }
      });
    }
  });
}
