import { createPortal } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';

/** A single item in a context menu. `separator: true` renders a divider (label/action/checked are ignored). */
export interface CtxMenuItem {
  /** Display text for the menu item (optional for separators). */
  label?: string;
  /** Callback invoked when the item is selected (optional for separators). */
  action?: () => void;
  /** When true, a checkmark indicator is shown before the label. */
  checked?: boolean;
  /** When true, renders as a horizontal divider instead of a clickable item. */
  separator?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: CtxMenuItem[];
  onClose: () => void;
}

/**
 * Renders a positioned context menu as a portal at the given (x, y) coordinates.
 * Each item is rendered as a button with an optional checkmark prefix.
 * The menu closes when the user clicks outside it or right-clicks anywhere.
 */
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
      {items.map((item, i) => {
        if (item.separator) return <div key={i} class="ctx-menu-sep" />;
        return (
          <button key={i} class="ctx-menu-item" onClick={() => { onClose(); item.action!(); }}>
            {item.checked ? '✓ ' + item.label : item.label}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
