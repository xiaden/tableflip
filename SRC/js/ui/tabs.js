import { refreshResultGridLayout, refreshPreviewGridLayout } from './grid.js';

export function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === 'tab-' + name));

  if (name === 'results') {
    requestAnimationFrame(() => requestAnimationFrame(() => refreshResultGridLayout()));
  }
  if (name === 'preview') {
    requestAnimationFrame(() => requestAnimationFrame(() => refreshPreviewGridLayout()));
  }
}
window.switchTab = switchTab;

document.querySelectorAll('.tab-btn').forEach(b =>
  b.addEventListener('click', () => switchTab(b.dataset.tab)));
