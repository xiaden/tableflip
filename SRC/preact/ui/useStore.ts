/**
 * React adapter hook bridging the framework-agnostic pub/sub store to React's
 * rendering model via useSyncExternalStore.
 *
 * Provides selector-based subscriptions so components only re-render when their
 * selected slice of state actually changes (shallow equality comparison).
 *
 * The underlying store (core/store.ts) is NOT modified — this hook is a thin
 * read-only adapter.
 */

import { useSyncExternalStore, useRef } from 'react';
import { getStore } from '../core/store';
import type { AppState } from '../types';

/**
 * Shallow equality check for two values.
 * - Primitives: uses Object.is
 * - Objects/arrays: compares own enumerable keys with Object.is per key
 * - Different reference types: returns false
 */
function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (
    a === null || b === null ||
    typeof a !== 'object' || typeof b !== 'object'
  ) {
    return false;
  }

  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);
  if (keysA.length !== keysB.length) return false;

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key) || !Object.is(objA[key], objB[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Selector-based hook for subscribing to the application state store.
 *
 * Uses React's `useSyncExternalStore` for tear-free concurrent-mode-safe reads
 * from the external pub/sub store. A shallow equality check on the selected
 * slice prevents unnecessary re-renders when unrelated state changes.
 *
 * @typeParam T - The type of the selected state slice
 * @param selector - Function that extracts a slice from AppState
 * @returns The selected state slice (stable reference when shallow-equal)
 *
 * @example
 * ```tsx
 * // Only re-renders when state.tables changes
 * const tables = useStore(s => s.tables);
 *
 * // Only re-renders when the active tab changes
 * const activeTab = useStore(s => s.activeTab);
 * ```
 */
export function useStore<T>(selector: (state: AppState) => T): T {
  const sliceRef = useRef<T>(selector(getStore().getState()));

  const wrappedSelector = (): T => {
    const next = selector(getStore().getState());
    if (shallowEqual(sliceRef.current, next)) {
      return sliceRef.current;
    }
    sliceRef.current = next;
    return next;
  };

  return useSyncExternalStore(
    (cb) => getStore().subscribe(cb),
    wrappedSelector,
  );
}
