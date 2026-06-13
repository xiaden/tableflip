/**
 * Application entry point — initializes database, store, and renders the App.
 *
 * This is the esbuild entry point that produces the preact bundle.
 * It bootstraps the entire application by:
 * 1. Initializing the SQLite WASM runtime
 * 2. Creating the reactive state store
 * 3. Rendering the root App component to the DOM
 */

import { render, h } from 'preact';
import { initDb } from './core/sqldb';
import { initStore } from './core/store';
import { App } from './ui/app';

/**
 * Bootstrap the application.
 * Initializes the database and store, then mounts the Preact App.
 */
async function main(): Promise<void> {
  // 1. Initialize SQLite WASM runtime
  await initDb();

  // 2. Initialize the reactive state store
  initStore();

  // 3. Mount the root App component
  const root = document.getElementById('app');
  if (root) {
    render(h(App, null), root);
  } else {
    // If no #app element exists, create one and append to body
    const el = document.createElement('div');
    el.id = 'app';
    document.body.appendChild(el);
    render(h(App, null), el);
  }

  // 4. Remove loading overlay if present
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }

  // 5. Initialize tooltip engine for [data-tip] elements
  initTooltipEngine();
}

function initTooltipEngine(): void {
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
    if (document.querySelector('.ctx-menu')) return;
    const src = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
    if (!src) return;
    tipBox.textContent = src.dataset.tip!;
    tipBox.style.display = 'block';
    const r = src.getBoundingClientRect();
    const bw = 304;
    let left = r.left + r.width / 2 - bw / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - bw - 6));
    const top = r.top - tipBox.offsetHeight - 8;
    tipBox.style.left = left + 'px';
    tipBox.style.top = (top < 6 ? r.bottom + 8 : top) + 'px';
  });

  document.addEventListener('mouseout', (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-tip]')) tipBox.style.display = 'none';
  });
}

main().catch((err: unknown) => {
  console.error('[app] Failed to initialize:', err);
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.innerHTML = `
      <div style="font-size:2rem">⚠️</div>
      <div style="font-size:1rem;font-weight:600">Failed to load</div>
      <div style="font-size:0.8rem;color:var(--muted)">${String((err as Error).message || err)}</div>
    `;
  }
});
