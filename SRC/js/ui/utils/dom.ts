// DOM utility functions for cached element access and manipulation

const elementCache = new Map<string, HTMLElement | null>();

/**
 * Get element by ID with caching
 * @param id - Element ID
 * @returns Cached element or null if not found
 */
export function $(id: string): HTMLElement | null {
  if (!elementCache.has(id)) {
    elementCache.set(id, document.getElementById(id));
  }
  return elementCache.get(id) || null;
}

/**
 * Clear element cache (useful after DOM updates)
 */
export function clearCache(): void {
  elementCache.clear();
}

/**
 * Get element by ID, throw if not found
 * @param id - Element ID
 * @returns Element (never null)
 * @throws Error if element not found
 */
export function require$(id: string): HTMLElement {
  const el = $(id);
  if (!el) {
    throw new Error(`Required element #${id} not found`);
  }
  return el;
}

/**
 * Get all elements matching selector
 * @param selector - CSS selector
 * @returns Array of elements
 */
export function $$(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(selector)) as HTMLElement[];
}

/**
 * Create element with optional attributes and children
 * @param tag - HTML tag name
 * @param attrs - Optional attributes
 * @param children - Optional children (strings or elements)
 * @returns Created element
 */
export function createElement(
  tag: string,
  attrs?: Record<string, string>,
  ...children: (string | HTMLElement)[]
): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else {
      el.appendChild(child);
    }
  }
  return el;
}

/**
 * Set multiple styles on an element
 * @param el - Target element
 * @param styles - Style properties
 */
export function setStyles(el: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, styles);
}

/**
 * Add event listener with automatic cleanup tracking
 * @param el - Target element
 * @param event - Event name
 * @param handler - Event handler
 * @param options - Event options
 */
export function on<K extends keyof HTMLElementEventMap>(
  el: HTMLElement,
  event: K,
  handler: (e: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions
): void {
  el.addEventListener(event, handler as EventListener, options);
}

/**
 * Remove event listener
 * @param el - Target element
 * @param event - Event name
 * @param handler - Event handler
 * @param options - Event options
 */
export function off<K extends keyof HTMLElementEventMap>(
  el: HTMLElement,
  event: K,
  handler: (e: HTMLElementEventMap[K]) => void,
  options?: boolean | EventListenerOptions
): void {
  el.removeEventListener(event, handler as EventListener, options);
}

/**
 * Toggle class on element
 * @param el - Target element
 * @param className - Class name to toggle
 * @param force - Optional force add/remove
 */
export function toggleClass(el: HTMLElement, className: string, force?: boolean): void {
  el.classList.toggle(className, force);
}

/**
 * Check if element has class
 * @param el - Target element
 * @param className - Class name to check
 */
export function hasClass(el: HTMLElement, className: string): boolean {
  return el.classList.contains(className);
}

/**
 * Get dataset value
 * @param el - Target element
 * @param key - Dataset key
 */
export function getData(el: HTMLElement, key: string): string | undefined {
  return el.dataset[key];
}

/**
 * Set dataset value
 * @param el - Target element
 * @param key - Dataset key
 * @param value - Dataset value
 */
export function setData(el: HTMLElement, key: string, value: string): void {
  el.dataset[key] = value;
}
