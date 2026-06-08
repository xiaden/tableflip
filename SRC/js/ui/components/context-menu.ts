let activeCtxMenu: HTMLElement | null = null;

export interface CtxMenuItem {
  label: string;
  action: () => void;
}

export function showContextMenu(x: number, y: number, items: CtxMenuItem[]): void {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';

  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';

  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = 'ctx-menu-item';
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      closeContextMenu();
      item.action();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  activeCtxMenu = menu;

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth)  menu.style.left = (x - rect.width) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top  = (y - rect.height) + 'px';

  const close = (e: Event) => {
    if (activeCtxMenu && !activeCtxMenu.contains(e.target as Node)) {
      closeContextMenu();
    }
  };
  setTimeout(() => {
    document.addEventListener('click', close, { once: true });
    document.addEventListener('contextmenu', close, { once: true });
  }, 0);
}

export function closeContextMenu(): void {
  if (activeCtxMenu) {
    activeCtxMenu.remove();
    activeCtxMenu = null;
  }
}
