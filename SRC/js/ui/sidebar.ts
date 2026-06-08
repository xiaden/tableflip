import { db } from '../core/state.js';
import { h, getTableColor } from '../core/utils.js';
import { dropTable } from '../core/sqldb.js';
import { renderQueryBuilder } from './views/query-builder.js';
import { renderPreviewDropdown, loadPreview } from './grid.js';
import { switchTab } from './tabs.js';

export function renderSidebar(): void {
  const ids = Object.keys(db.tables).sort((a: string, b: string) => db.tables[a].name.localeCompare(db.tables[b].name));
  document.getElementById('tableCount')!.textContent = String(ids.length);
  const list = document.getElementById('tablesList')!;

  if (!ids.length) {
    list.innerHTML = '<div class="empty" style="flex:none;padding:16px"><div class="empty-icon">📋</div><div>No tables loaded</div></div>';
    return;
  }

  list.innerHTML = ids.map((id: string) => {
    const t = db.tables[id];
    return `<div class="tcard" data-tid="${id}" style="border-left:3px solid ${getTableColor(id)}">
      <div class="tcard-rm" data-rm="${id}">✕</div>
      <div class="tcard-name" title="${h(t.name)}">${h(t.name)}</div>
      <div class="tcard-meta">${t.rowCount.toLocaleString()} rows &middot; ${t.cols.length} cols</div>
    </div>`;
  }).join('');
}

if (typeof document !== 'undefined') {
  document.getElementById('tablesList')!.addEventListener('click', (e: Event) => {
    const rm   = (e.target as HTMLElement).closest('[data-rm]') as HTMLElement | null;
    const card = (e.target as HTMLElement).closest('[data-tid]') as HTMLElement | null;
    if (rm)        removeTable(rm.dataset.rm!);
    else if (card) previewTable(card.dataset.tid!);
  });
}

export function removeTable(id: string): void {
  dropTable(id);
  delete db.tables[id];

  if (db.base === id) {
    Object.assign(db, { base: '', selCols: null, groupBy: [], aggregates: [], filters: [] });
  }

  renderSidebar();
  renderQueryBuilder();
  renderPreviewDropdown();
}

export function previewTable(id: string): void {
  (document.getElementById('previewSel') as HTMLSelectElement).value = id;
  switchTab('preview');
  loadPreview();
}
