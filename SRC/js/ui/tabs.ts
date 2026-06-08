import { refreshResultGridLayout, refreshPreviewGridLayout } from './grid.js';

export function switchTab(name: string): void {
  document.querySelectorAll('.tab-btn').forEach((b: Element) =>
    b.classList.toggle('active', (b as HTMLElement).dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p: Element) =>
    p.classList.toggle('active', p.id === 'tab-' + name));

  if (name === 'results') {
    requestAnimationFrame(() => requestAnimationFrame(() => refreshResultGridLayout()));
  }
  if (name === 'preview') {
    requestAnimationFrame(() => requestAnimationFrame(() => refreshPreviewGridLayout()));
  }
}
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).switchTab = switchTab;

if (typeof document !== 'undefined') {
  document.querySelectorAll('.tab-btn').forEach((b: Element) =>
    b.addEventListener('click', () => switchTab((b as HTMLElement).dataset.tab!)));
}
