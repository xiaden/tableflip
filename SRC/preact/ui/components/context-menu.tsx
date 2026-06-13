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
