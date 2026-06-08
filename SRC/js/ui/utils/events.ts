// Event delegation utilities

/**
 * Delegate event handling to a parent element
 * @param parent - Parent element to attach listener to
 * @param selector - CSS selector for target elements
 * @param event - Event name
 * @param handler - Handler function, receives target element and event
 */
export function delegate<K extends keyof HTMLElementEventMap>(
  parent: HTMLElement,
  selector: string,
  event: K,
  handler: (target: HTMLElement, event: HTMLElementEventMap[K]) => void
): void {
  parent.addEventListener(event, ((e: HTMLElementEventMap[K]) => {
    const target = (e.target as HTMLElement).closest(selector) as HTMLElement | null;
    if (target && parent.contains(target)) {
      handler(target, e);
    }
  }) as EventListener);
}

/**
 * Create a delegated click handler
 * @param parent - Parent element
 * @param selector - CSS selector for clickable elements
 * @param handler - Click handler
 */
export function onClick(
  parent: HTMLElement,
  selector: string,
  handler: (target: HTMLElement, event: MouseEvent) => void
): void {
  delegate(parent, selector, 'click', handler);
}

/**
 * Create a delegated change handler
 * @param parent - Parent element
 * @param selector - CSS selector for input elements
 * @param handler - Change handler
 */
export function onChange(
  parent: HTMLElement,
  selector: string,
  handler: (target: HTMLElement, event: Event) => void
): void {
  delegate(parent, selector, 'change', handler);
}

/**
 * Create a delegated input handler
 * @param parent - Parent element
 * @param selector - CSS selector for input elements
 * @param handler - Input handler
 */
export function onInput(
  parent: HTMLElement,
  selector: string,
  handler: (target: HTMLElement, event: Event) => void
): void {
  delegate(parent, selector, 'input', handler);
}

/**
 * Create a delegated dblclick handler
 * @param parent - Parent element
 * @param selector - CSS selector for elements
 * @param handler - Double-click handler
 */
export function onDblClick(
  parent: HTMLElement,
  selector: string,
  handler: (target: HTMLElement, event: MouseEvent) => void
): void {
  delegate(parent, selector, 'dblclick', handler);
}

/**
 * Create a delegated contextmenu handler
 * @param parent - Parent element
 * @param selector - CSS selector for elements
 * @param handler - Context menu handler
 */
export function onContextMenu(
  parent: HTMLElement,
  selector: string,
  handler: (target: HTMLElement, event: MouseEvent) => void
): void {
  delegate(parent, selector, 'contextmenu', handler);
}

/**
 * Setup drag and drop delegation
 * @param parent - Parent element
 * @param selector - CSS selector for draggable elements
 * @param handlers - Drag event handlers
 */
export function onDragDrop(
  parent: HTMLElement,
  selector: string,
  handlers: {
    dragstart?: (target: HTMLElement, event: DragEvent) => void;
    dragend?: (target: HTMLElement, event: DragEvent) => void;
    dragover?: (target: HTMLElement, event: DragEvent) => void;
    drop?: (target: HTMLElement, event: DragEvent) => void;
  }
): void {
  if (handlers.dragstart) delegate(parent, selector, 'dragstart', handlers.dragstart);
  if (handlers.dragend) delegate(parent, selector, 'dragend', handlers.dragend);
  if (handlers.dragover) delegate(parent, selector, 'dragover', handlers.dragover);
  if (handlers.drop) delegate(parent, selector, 'drop', handlers.drop);
}
