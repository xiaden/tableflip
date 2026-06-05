'use strict';

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === 'tab-' + name));

  // AG Grid can render incorrectly when initialized in a hidden panel.
  // After a tab becomes visible, force a layout refresh pass.
  if (name === 'results' && typeof refreshResultGridLayout === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(() => refreshResultGridLayout()));
  }
  if (name === 'preview' && typeof refreshPreviewGridLayout === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(() => refreshPreviewGridLayout()));
  }
}

document.querySelectorAll('.tab-btn').forEach(b =>
  b.addEventListener('click', () => switchTab(b.dataset.tab)));
