/**
 * Loader UI — file drop zone, sheet selector modal, file input handler.
 *
 * Ported from `SRC/js/ui/loader.ts`. Key differences:
 * - Preact component with store.subscribe() for reactive updates
 * - Sheet selector uses Preact Modal component instead of manual DOM
 * - File drop uses Preact event handlers instead of window assignments
 * - Delegates data ingestion to loader.ts (data layer)
 * - No window assignments (confirmModal, closeModal)
 */

import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { getStore } from '../core/store';
import { toast, stripExt } from '../core/utils';
import { loadSpreadsheet, loadSheets, ingestSheet } from './loader';
import { Modal } from './components/modal';

/**
 * Programmatically opens the file picker dialog.
 * Safe to call from any component — triggers the hidden file input rendered by Loader.
 */
export function triggerFileInput(): void {
  document.getElementById('fileInput')?.click();
}

// ── Sheet selector modal ─────────────────────────────────────────────────────

interface SheetInfo {
  name: string;
  rows: string;
  cols: string | number;
}

interface PendingWorkbook {
  wb: XLSXWorkbook;
  filename: string;
  sheets: SheetInfo[];
}

/**
 * Sheet selector modal for multi-sheet workbooks.
 * Displays checkboxes for each sheet and lets the user confirm which to import.
 */
function SheetSelectorModal({
  pending,
  onConfirm,
  onClose,
}: {
  pending: PendingWorkbook;
  onConfirm: (selected: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(pending.sheets.map(s => s.name))
  );

  const toggle = useCallback((name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm([...selected]);
  }, [selected, onConfirm]);

  return (
    <Modal
      open={true}
      title="Select sheets to import"
      onClose={onClose}
      buttons={[
        { label: 'Cancel', action: onClose },
        { label: 'Import', primary: true, action: handleConfirm },
      ]}
    >
      <div style="margin-bottom:8px;font-size:0.78rem;color:var(--muted)">
        File: <strong>{pending.filename}</strong>
      </div>
      <div id="modalSheets">
        {pending.sheets.map(sheet => {
          const id = 'chk_' + sheet.name.replace(/[^A-Za-z0-9]/g, '_');
          return (
            <div key={sheet.name} class="sheet-opt">
              <label style="display:flex;align-items:center;gap:10px;flex:1;cursor:pointer">
                <input
                  type="checkbox"
                  id={id}
                  checked={selected.has(sheet.name)}
                  onChange={() => toggle(sheet.name)}
                  style="width:14px;height:14px;flex-shrink:0"
                />
                <div>
                  <div class="sheet-opt-name">{sheet.name}</div>
                  <div class="sheet-opt-meta">
                    ~{sheet.rows} rows · {sheet.cols} cols
                  </div>
                </div>
              </label>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

// ── File drop overlay ────────────────────────────────────────────────────────

/**
 * Drop overlay shown when files are dragged over the page.
 */
function DropOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div id="dropOverlay" class="drop-overlay active">
      <div class="do-icon">{'\u{1F4C2}'}</div>
      <div class="do-label">Drop files to import</div>
    </div>
  );
}

// ── Loading overlay ──────────────────────────────────────────────────────────

/**
 * Loading overlay shown during file processing.
 */
function LoadOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div id="loadOverlay" class="load-overlay active">
      <div class="lo-spinner" />
      <div class="lo-title">Loading...</div>
    </div>
  );
}

// ── Main Loader component ────────────────────────────────────────────────────

/**
 * Main loader component — handles file drops, file input, and sheet selection.
 * Renders drop overlay, loading overlay, and sheet selector modal.
 */
export function Loader() {
  const [dropActive, setDropActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingModal, setPendingModal] = useState<PendingWorkbook | null>(null);
  const pendingModalRef = useRef<PendingWorkbook | null>(null);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const store = getStore();
    let sheetCount = 0;

    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()!.toLowerCase();

      if (ext === 'rcjson') {
        await loadSpreadsheet(file, store);
        continue;
      }

      if (!['xlsx', 'xls', 'csv'].includes(ext)) {
        toast(`Unsupported file type ".${ext}" — drop xlsx, xls, csv, or rcjson files.`, 'err');
        continue;
      }

      setLoading(true);

      if (ext === 'csv') {
        const text = await file.text();
        try {
          const wb = XLSX.read(text, { type: 'string', dense: true });
          ingestSheet(wb, wb.SheetNames[0], stripExt(file.name), store);
          sheetCount++;
        } catch (ex) {
          toast('Could not parse ' + file.name + ': ' + (ex as Error).message, 'err');
        }
      } else {
        const buffer = await file.arrayBuffer();
        try {
          const wb = XLSX.read(buffer, { type: 'array', cellDates: true, dense: true });
          const usable = wb.SheetNames.filter((n: string) => wb.Sheets[n] && wb.Sheets[n]['!ref']);
          if (!usable.length) {
            toast('No data found in ' + file.name, 'err');
          } else if (usable.length === 1) {
            ingestSheet(wb, usable[0], stripExt(file.name), store);
            sheetCount++;
          } else {
            // Show sheet selector modal
            setLoading(false);
            const sheets: SheetInfo[] = usable.map(name => {
              const ws = wb.Sheets[name];
              let rows = '?';
              let cols: string | number = '?';
              try {
                const r = XLSX.utils.decode_range(ws['!ref']!);
                rows = (r.e.r - r.s.r).toLocaleString();
                cols = r.e.c - r.s.c + 1;
              } catch { /* ignore */ }
              return { name, rows, cols };
            });
            const pending = { wb, filename: file.name, sheets };
            pendingModalRef.current = pending;
            setPendingModal(pending);
            // Wait for modal confirmation
            await new Promise<void>(resolve => {
              // The modal will call onConfirm which processes the sheets
              // We store the resolve for later
              (window as unknown as Record<string, unknown>).__loaderResolve = resolve;
            });
          }
        } catch (ex) {
          toast('Could not parse ' + file.name + ': ' + (ex as Error).message, 'err');
        }
      }

      setLoading(false);
    }

    if (sheetCount > 0) {
      toast(`Loaded ${sheetCount} sheet${sheetCount !== 1 ? 's' : ''}`, 'ok');
    }
  }, []);

  const handleConfirmSheets = useCallback((selected: string[]) => {
    const pending = pendingModalRef.current;
    if (pending && selected.length > 0) {
      const store = getStore();
      loadSheets(pending.wb, selected, store);
      toast(`Loaded ${selected.length} sheet${selected.length !== 1 ? 's' : ''}`, 'ok');
    }
    pendingModalRef.current = null;
    setPendingModal(null);
    const resolve = (window as unknown as Record<string, unknown>).__loaderResolve as (() => void) | undefined;
    if (resolve) {
      resolve();
      delete (window as unknown as Record<string, unknown>).__loaderResolve;
    }
  }, []);

  const handleCloseModal = useCallback(() => {
    pendingModalRef.current = null;
    setPendingModal(null);
    const resolve = (window as unknown as Record<string, unknown>).__loaderResolve as (() => void) | undefined;
    if (resolve) {
      resolve();
      delete (window as unknown as Record<string, unknown>).__loaderResolve;
    }
  }, []);

  // Drag-and-drop handlers
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      dragDepth.current++;
      setDropActive(true);
    };

    const handleDragLeave = () => {
      dragDepth.current--;
      if (dragDepth.current <= 0) {
        dragDepth.current = 0;
        setDropActive(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      dragDepth.current = 0;
      setDropActive(false);
      if (e.defaultPrevented) return;
      e.preventDefault();
      if (e.dataTransfer?.files) {
        processFiles(e.dataTransfer.files);
      }
    };

    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);

    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
    };
  }, [processFiles]);

  const handleFileInput = useCallback((e: Event) => {
    const target = e.target as HTMLInputElement;
    if (target.files) {
      processFiles(target.files);
      target.value = '';
    }
  }, [processFiles]);

  return (
    <>
      <DropOverlay active={dropActive} />
      <LoadOverlay active={loading} />
      {pendingModal && (
        <SheetSelectorModal
          pending={pendingModal}
          onConfirm={handleConfirmSheets}
          onClose={handleCloseModal}
        />
      )}
      <input
        ref={fileInputRef}
        id="fileInput"
        type="file"
        accept=".xlsx,.xls,.csv,.rcjson"
        multiple
        style="display:none"
        onChange={handleFileInput}
      />
    </>
  );
}
