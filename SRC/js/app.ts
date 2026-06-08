import './core/state.js';
import './core/utils.js';
import { initDb } from './core/sqldb.js';
import './catalog/source-catalog.js';
import './catalog/column-catalog.js';
import './report/result-set.js';
import './report/output-layout.js';
import './query/sql-where.js';
import './query/sql-aggregates.js';
import './query/sql-calcs.js';
import './query/sql-joins.js';
import './query/sql-detail.js';
import './query/sql-grouped.js';
import './query/sql-totals.js';
import './query/sql-subtotals.js';
import './query/sql-renderer.js';
import './query/query-plan.js';
import './query/lookup-resolver.js';
import './report/report-graph.js';
import './report/report-output.js';
import './report/engine.js';
import './report/calc-validator.js';
import './report/validation.js';
import './ui/tabs.js';
import './ui/grid.js';
import './ui/export.js';
import './ui/aggregation.js';
import './core/state-schema.js';
import './core/state-serializer.js';
import './core/state-hydrator.js';
import './core/state-applier.js';
import './core/state-loader.js';
import './core/state-io.js';
import './query/layout-selection.js';
import './query/alias-ref-updater.js';
import './ui/views/query-builder.js';
import './ui/views/pipeline-card.js';
import './ui/views/output-card.js';
import './ui/views/filter-sort-card.js';
import './ui/sidebar.js';
import './ui/loader.js';
import { isContextMenuOpen } from './ui/components/context-menu.js';

if (typeof window !== 'undefined') window.initDb = initDb;

initDb()
  .then(() => {
    document.getElementById('loadingOverlay')!.style.display = 'none';
  })
  .catch((err: Error) => {
    document.getElementById('loadingOverlay')!.innerHTML = `
      <div style="font-size:2rem">❌</div>
      <div style="font-size:1rem;font-weight:600">Failed to load database engine</div>
      <div style="font-size:0.8rem;color:var(--muted)">${err.message}</div>
      <div style="font-size:0.8rem;color:var(--muted);margin-top:6px">Check your internet connection — the SQLite WASM runtime is fetched from cdn.jsdelivr.net.</div>
    `;
  });

if (!window.XLSX) {
  console.error('[xlsx] runtime missing');
} else if (window.XLSX.style_version !== '1.3.0') {
  console.warn('[xlsx] expected xlsx-js-style 1.3.0, got', window.XLSX.style_version || window.XLSX.version);
}

if (typeof document !== 'undefined') {
  const tipBox = document.createElement('div');
  Object.assign(tipBox.style, {
    position: 'fixed', zIndex: '9500', display: 'none',
    background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: '8px', padding: '9px 13px',
    fontSize: '0.76rem', lineHeight: '1.6', color: 'var(--text)',
    whiteSpace: 'pre-wrap', maxWidth: '300px', pointerEvents: 'none',
    boxShadow: '0 4px 20px rgba(0,0,0,0.55)',
  });
  document.body.appendChild(tipBox);

  document.addEventListener('mouseover', (e: MouseEvent) => {
    if (isContextMenuOpen()) return;
    const src = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
    if (!src) return;
    tipBox.textContent = src.dataset.tip!;
    tipBox.style.display = 'block';
    const r   = src.getBoundingClientRect();
    const bw  = 304;
    let left  = r.left + r.width / 2 - bw / 2;
    left      = Math.max(6, Math.min(left, window.innerWidth - bw - 6));
    const top = r.top - tipBox.offsetHeight - 8;
    tipBox.style.left = left + 'px';
    tipBox.style.top  = (top < 6 ? r.bottom + 8 : top) + 'px';
  });

  document.addEventListener('mouseout', (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-tip]')) tipBox.style.display = 'none';
  });
}
