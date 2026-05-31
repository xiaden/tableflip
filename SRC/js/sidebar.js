'use strict';

function renderSidebar() {
  const ids = Object.keys(db.tables).sort((a, b) => db.tables[a].name.localeCompare(db.tables[b].name));
  document.getElementById('tableCount').textContent = ids.length;
  const list = document.getElementById('tablesList');

  if (!ids.length) {
    list.innerHTML = '<div class="empty" style="flex:none;padding:16px"><div class="empty-icon">📋</div><div>No tables loaded</div></div>';
    return;
  }

  list.innerHTML = ids.map(id => {
    const t = db.tables[id];
    return `<div class="tcard" data-tid="${id}" style="border-left:3px solid ${getTableColor(id)}">
      <div class="tcard-rm" data-rm="${id}">✕</div>
      <div class="tcard-name" title="${h(t.name)}">${h(t.name)}</div>
      <div class="tcard-meta">${t.rowCount.toLocaleString()} rows &middot; ${t.cols.length} cols</div>
    </div>`;
  }).join('');
}

document.getElementById('tablesList').addEventListener('click', e => {
  const rm   = e.target.closest('[data-rm]');
  const card = e.target.closest('[data-tid]');
  if (rm)        removeTable(rm.dataset.rm);
  else if (card) previewTable(card.dataset.tid);
});

function removeTable(id) {
  dropTable(id); // release from SQLite WASM heap
  delete db.tables[id];

  if (db.base === id) {
    Object.assign(db, { base: '', joins: [], selCols: null, groupBy: [], aggregates: [], filters: [] });
  }
  db.joins = db.joins.filter(j => j.rightId !== id);

  renderSidebar();
  renderQueryBuilder();
  renderPreviewDropdown();
}

function previewTable(id) {
  document.getElementById('previewSel').value = id;
  switchTab('preview');
  loadPreview();
}
