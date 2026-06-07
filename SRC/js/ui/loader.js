import { db } from '../core/state.js';
import { h, toast, stickyToast, stripExt, getTableColor } from '../core/utils.js';
import { loadState } from '../core/state-loader.js';
import { dropTable, createTable, insertRows, tableRowCount } from '../core/sqldb.js';
import { renderSidebar } from './sidebar.js';
import { renderQueryBuilder } from '../query/query-builder.js';
import { renderPreviewDropdown, loadPreview } from './grid.js';
import { switchTab } from './tabs.js';

let _pendingLoads  = 0;
let _sheetsLoaded  = 0;

function _loadOverlay()  { return document.getElementById('loadOverlay'); }

function _startLoad() {
  _pendingLoads++;
  _loadOverlay().classList.add('active');
}

function _endLoad() {
  _pendingLoads = Math.max(0, _pendingLoads - 1);
  if (_pendingLoads === 0) {
    _loadOverlay().classList.remove('active');
    const n = _sheetsLoaded;
    _sheetsLoaded = 0;
    toast(`Loaded ${n} sheet${n !== 1 ? 's' : ''}`, 'ok');
  }
}

function _countSheet() { _sheetsLoaded++; }

const _modalQueue = [];
let   _modalOpen  = false;

function _enqueueModal(wb, filename, sheets) {
  _modalQueue.push({ wb, filename, sheets });
  if (!_modalOpen) _showNextModal();
}

function _showNextModal() {
  if (!_modalQueue.length) { _modalOpen = false; return; }
  _modalOpen = true;
  const { wb, filename, sheets } = _modalQueue[0];

  document.getElementById('modalFile').textContent = filename;
  const container = document.getElementById('modalSheets');
  container.innerHTML = '';

  sheets.forEach(name => {
    const ws = wb.Sheets[name];
    let rows = '?', cols = '?';
    try {
      const r = XLSX.utils.decode_range(ws['!ref']);
      rows = (r.e.r - r.s.r).toLocaleString();
      cols = r.e.c - r.s.c + 1;
    } catch (_) {}

    const id  = 'chk_' + Math.random().toString(36).slice(2);
    const row = document.createElement('div');
    row.className = 'sheet-opt';
    row.innerHTML = `
      <label style="display:flex;align-items:center;gap:10px;flex:1;cursor:pointer">
        <input type="checkbox" id="${h(id)}" value="${h(name)}" checked style="width:14px;height:14px;flex-shrink:0">
        <div>
          <div class="sheet-opt-name">${h(name)}</div>
          <div class="sheet-opt-meta">~${rows} rows &middot; ${cols} cols</div>
        </div>
      </label>`;
    container.appendChild(row);
  });

  document.getElementById('sheetModal').style.display = 'flex';
}

export function confirmModal() {
  if (!_modalQueue.length) return;
  const { wb, filename, sheets } = _modalQueue.shift();
  const checked = [...document.querySelectorAll('#modalSheets input[type=checkbox]:checked')]
    .map(cb => cb.value);

  document.getElementById('sheetModal').style.display = 'none';

  if (checked.length) {
    _startLoad();
    for (const name of checked) {
      const label = sheets.length === 1 ? stripExt(filename) : stripExt(filename) + ' — ' + name;
      ingestSheet(wb, name, label);
      _countSheet();
    }
    _endLoad();
  }

  _showNextModal();
}
window.confirmModal = confirmModal;

export function closeModal() {
  if (!_modalQueue.length) return;
  _modalQueue.shift();
  document.getElementById('sheetModal').style.display = 'none';
  _showNextModal();
}
window.closeModal = closeModal;

(function () {
  const overlay = document.getElementById('dropOverlay');
  let dragDepth = 0;

  document.addEventListener('dragenter', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragDepth++;
    overlay.classList.add('active');
  });

  document.addEventListener('dragleave', () => {
    dragDepth--;
    if (dragDepth <= 0) { dragDepth = 0; overlay.classList.remove('active'); }
  });

  document.addEventListener('dragover', e => { e.preventDefault(); });

  document.addEventListener('drop', e => {
    dragDepth = 0;
    overlay.classList.remove('active');
    if (e.defaultPrevented) return;
    e.preventDefault();
    [...e.dataTransfer.files].forEach(loadFile);
  });
})();

const fileInput = document.getElementById('fileInput');

fileInput.addEventListener('change', e => {
  [...e.target.files].forEach(loadFile);
  fileInput.value = '';
});

function loadFile(file) {
  if (!window.sqlDb) { toast('Database not ready yet', 'err'); return; }
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'rcjson') {
    loadState(file);
    return;
  }

  if (!['xlsx', 'xls', 'csv'].includes(ext)) {
    toast(`Unsupported file type ".${ext}" — drop xlsx, xls, csv, or rcjson files.`, 'err');
    return;
  }

  const reader = new FileReader();

  if (ext === 'csv') {
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'string', dense: true });
        ingestSheet(wb, wb.SheetNames[0], stripExt(file.name));
        _countSheet();
      } catch (ex) { toast('Could not parse ' + file.name + ': ' + ex.message, 'err'); }
      _endLoad();
    };
    reader.onerror = () => { toast('Could not read ' + file.name, 'err'); _endLoad(); };
    _startLoad();
    reader.readAsText(file);
  } else {
    reader.onload = ev => {
      try {
        let wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array', cellDates: true, dense: true });
        const usable = wb.SheetNames.filter(n => wb.Sheets[n] && wb.Sheets[n]['!ref']);
        if (!usable.length) { toast('No data found in ' + file.name, 'err'); _endLoad(); return; }
        if (usable.length === 1) {
          ingestSheet(wb, usable[0], stripExt(file.name));
          _countSheet();
        } else {
          _enqueueModal(wb, file.name, usable);
        }
        wb = null;
      } catch (ex) { toast('Could not parse ' + file.name + ': ' + ex.message, 'err'); }
      _endLoad();
    };
    reader.onerror = () => { toast('Could not read ' + file.name, 'err'); _endLoad(); };
    _startLoad();
    reader.readAsArrayBuffer(file);
  }
}

function expandMerges(ws) {
  const merges = ws['!merges'];
  if (!merges || !merges.length) return;

  const dense = Array.isArray(ws['!data']) ? ws['!data'] : (Array.isArray(ws) ? ws : null);
  if (dense) {
    merges.forEach(({ s, e }) => {
      const srcCell = (dense[s.r] || [])[s.c];
      if (!srcCell) return;
      for (let r = s.r; r <= e.r; r++) {
        if (!dense[r]) dense[r] = [];
        for (let c = s.c; c <= e.c; c++) {
          if (r === s.r && c === s.c) continue;
          const tgt = dense[r][c];
          if (!tgt || tgt.v == null || tgt.t === 'z') {
            dense[r][c] = { ...srcCell };
          }
        }
      }
    });
    return;
  }

  merges.forEach(({ s, e }) => {
    const srcAddr = XLSX.utils.encode_cell({ r: s.r, c: s.c });
    const srcCell = ws[srcAddr];
    if (!srcCell) return;
    for (let r = s.r; r <= e.r; r++) {
      for (let c = s.c; c <= e.c; c++) {
        if (r === s.r && c === s.c) continue;
        const addr = XLSX.utils.encode_cell({ r, c });
        const tgt = ws[addr];
        if (!tgt || tgt.v == null || tgt.t === 'z') {
          ws[addr] = { ...srcCell };
        }
      }
    }
  });
}

function ingestSheet(wb, sheetName, label) {
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws['!ref']) { toast('Empty sheet: ' + sheetName, 'err'); return; }

  expandMerges(ws);

  let rawData;
  try {
    rawData = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true, blankrows: false });
  } catch (ex) { toast('Parse error: ' + ex.message, 'err'); return; }

  if (!rawData.length) { toast('No rows found in ' + sheetName, 'err'); return; }

  const _ROWNO = '_rowno';
  rawData.forEach((row, i) => { row[_ROWNO] = i + 1; });

  const cols    = Object.keys(rawData[0]).filter(c => c !== _ROWNO);
  const allCols = [_ROWNO, ...cols];

  const id = 't_' + label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();

  if (db.tables[id]) {
    dropTable(id);
    delete db.excludedRows[id];
  }

  try {
    createTable(id, allCols);
    insertRows(id, allCols, rawData);
  } catch (ex) {
    dropTable(id);
    toast('DB insert error: ' + ex.message, 'err');
    return;
  }

  const TOTAL_RE = /^\s*(grand\s+)?total[s]?\s*[:：]?|subtotal[s]?\s*[:：]?/i;
  const suggested = new Set();
  const suggestedPreviews = new Map();
  for (const row of rawData) {
    for (const c of cols) {
      const v = row[c];
      if (v == null) continue;
      if (TOTAL_RE.test(String(v))) {
        suggested.add(row[_ROWNO]);
        const snippets = cols
          .map(col => row[col])
          .filter(val => val != null && String(val).trim() !== '')
          .slice(0, 5)
          .map(val => String(val).trim());
        suggestedPreviews.set(row[_ROWNO], snippets.join(' · '));
        break;
      }
    }
  }

  const samples = {};
  for (const col of cols) {
    const seen = new Set();
    const vals = [];
    for (const row of rawData) {
      const v = row[col];
      if (v == null) continue;
      const s = String(v).trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      vals.push(s);
      if (vals.length >= 3) break;
    }
    samples[col] = vals;
  }

  rawData = null;

  db.excludedRows[id] = new Set();
  const rowCount = tableRowCount(id);
  db.tables[id] = { id, name: label, cols, rowCount, samples };
  getTableColor(id);

  if (!db.base) db.base = id;

  renderSidebar();
  renderQueryBuilder();
  renderPreviewDropdown();

  if (suggested.size) {
    const previews = [...suggestedPreviews.values()];
    const previewStr = previews.length === 1
      ? `"${previews[0]}"`
      : previews.map(p => `"${p}"`).join(', ');
    const noun = suggested.size === 1 ? 'row' : 'rows';
    const btnLabel = suggested.size === 1 ? 'Exclude it' : 'Exclude them';
    stickyToast(
      `"${label}": ${suggested.size} ${noun} may be a totals ${noun}\nRow contents → ${previewStr}`,
      'warn',
      () => {
        db.excludedRows[id] = new Set(suggested);
        if (document.getElementById('previewSel').value === id) loadPreview();
      },
      btnLabel
    );
  }
}
