import { createPortal } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';

export interface CtxMenuItem {
  label: string;
  action: () => void;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: CtxMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';

    const close = (e: Event) => {
      if (!menu.contains(e.target as Node)) onClose();
    };
    setTimeout(() => {
      document.addEventListener('click', close, { once: true });
      document.addEventListener('contextmenu', close, { once: true });
    }, 0);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
    };
  }, [x, y, onClose]);

  return createPortal(
    <div class="ctx-menu" ref={menuRef} style={{ left: x + 'px', top: y + 'px' }}>
      {items.map((item, i) => (
        <button
          key={i}
          class="ctx-menu-item"
          onClick={() => { onClose(); item.action(); }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  );
}

// ── Legacy imperative API (temporary bridge until views migrate) ──

import { render } from 'preact/compat';

let _legacyContainer: HTMLElement | null = null;

function _hideTooltip(): void {
  const tipBox = document.querySelector('[style*="z-index: 9500"]') as HTMLElement | null;
  if (tipBox) tipBox.style.display = 'none';
}

export function isContextMenuOpen(): boolean {
  return _legacyContainer !== null;
}

export function showContextMenu(x: number, y: number, items: CtxMenuItem[]): void {
  closeContextMenu();
  _hideTooltip();

  const container = document.createElement('div');
  document.body.appendChild(container);
  _legacyContainer = container;

  render(
    <ContextMenu
      x={x}
      y={y}
      items={items}
      onClose={closeContextMenu}
    />,
    container
  );
}

export function closeContextMenu(): void {
  if (_legacyContainer) {
    render(null, _legacyContainer);
    _legacyContainer.remove();
    _legacyContainer = null;
  }
}
