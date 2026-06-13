/**
 * Sidebar — table list with color chips, remove table, preview table.
 *
 * Ported from `SRC/js/ui/sidebar.ts`. Key differences:
 * - Preact component with store.subscribe() for reactive updates
 * - No innerHTML — uses JSX for rendering
 * - State mutations go through store.update()
 * - Remove/preview actions call store directly instead of re-render functions
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { getStore } from '../core/store';
import { h, getTableColor, toggleSidebar } from '../core/utils';
import { dropTable } from '../core/sqldb';
import { triggerFileInput } from './file-loader';
import { saveState } from '../core/state-serializer';
import type { AppState, DbTable } from '../types';

/**
 * Sidebar component displaying loaded tables with color chips.
 * Supports removing tables and previewing table data.
 */
export function Sidebar() {
  const [state, setState] = useState<AppState>(getStore().getState());

  useEffect(() => {
    const unsub = getStore().subscribe((s) => setState(s));
    return unsub;
  }, []);

  const tables = state.tables;
  const ids = Object.keys(tables).sort((a, b) =>
    tables[a].name.localeCompare(tables[b].name)
  );

  const handleRemove = useCallback((id: string) => {
    dropTable(id);
    getStore().update(draft => {
      delete draft.tables[id];
      delete draft.excludedRows[id];
      delete draft.tableColors[id];
      if (draft.base === id) {
        draft.base = '';
        draft.selCols = null;
        draft.groupBy = [];
        draft.aggregates = [];
        draft.filters = [];
      }
    });
  }, []);

  const handlePreview = useCallback((id: string) => {
    getStore().update(draft => {
      draft.previewTableId = id;
      draft.activeTab = 'preview';
    });
  }, []);

  return (
    <>
      <div class="sidebar-wrap">
        <div id="sidebar" class="sidebar">
          <div class="sb-sec">
            <div id="dropZone" onClick={triggerFileInput}>
              <div class="dz-icon">📂</div>
              <div class="dz-main">Import files</div>
              <div class="dz-sub">Drop xlsx, csv, or rcjson here</div>
            </div>
          </div>
          <div class="sb-sec">
            <h3>Tables ({ids.length})</h3>
          </div>
          <div id="tablesList" class="tables-list">
            {ids.length === 0 ? (
              <div class="empty" style="flex:none;padding:16px">
                <div class="empty-icon">📋</div>
                <div>No tables loaded</div>
              </div>
            ) : (
              ids.map(id => {
                const t = tables[id];
                const color = getTableColor(id);
                return (
                  <div
                    key={id}
                    class="tcard"
                    data-tid={id}
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <div
                      class="tcard-rm"
                      data-rm={id}
                      onClick={(e: Event) => {
                        e.stopPropagation();
                        handleRemove(id);
                      }}
                    >
                      ✕
                    </div>
                    <div
                      class="tcard-name"
                      title={t.name}
                      onClick={() => handlePreview(id)}
                    >
                      {t.name}
                    </div>
                    <div class="tcard-meta">
                      {t.rowCount.toLocaleString()} rows · {t.cols.length} cols
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {state.base && (
            <div class="sidebar-footer">
              <button class="sidebar-save-btn" onClick={saveState} data-tip="Save your current report setup (sheets, columns, filters, sort, summary) as a file you can reload later.">
                Save Report Config
              </button>
            </div>
          )}
        </div>
      </div>
      <div id="sidebarToggle" class="sidebar-toggle" onClick={toggleSidebar}>
        ❮
      </div>
    </>
  );
}
