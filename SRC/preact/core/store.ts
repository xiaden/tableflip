import type { AppState } from '../types';
import { createAppState } from './state';

/** Deep clone that preserves Set objects (unlike JSON.parse/stringify). */
function deepClone<T>(obj: T): T {
  if (obj instanceof Set) return new Set(obj) as unknown as T;
  if (Array.isArray(obj)) return obj.map(deepClone) as unknown as T;
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = deepClone(v);
    return out as T;
  }
  return obj;
}

/** Listener function called on state changes with new and previous state. */
type Listener = (state: AppState, prev: AppState) => void;

/**
 * Reactive state store interface providing pub/sub state management.
 * All state mutations go through update() or set() to ensure consistency.
 */
export interface Store {
  /** Returns the current state snapshot (read-only reference). */
  getState(): AppState;

  /**
   * Subscribes a listener to state changes.
   * @param listener - Called with (newState, prevState) on every update
   * @returns Unsubscribe function — call to remove the listener
   */
  subscribe(listener: Listener): () => void;

  /**
   * Applies a draft mutation to the state.
   * The updater receives a deep-cloned draft that can be mutated safely.
   * After the updater returns, listeners are notified with the new state.
   * @param updater - Draft mutator function (Immer-style pattern)
   */
  update(updater: (draft: AppState) => void): void;

  /**
   * Sets a single top-level state key to a new value.
   * More efficient than update() when only one field changes.
   * @param key - The state key to set
   * @param value - The new value for that key
   */
  set<K extends keyof AppState>(key: K, value: AppState[K]): void;
}

/**
 * Creates a new reactive store instance.
 * Use initStore() for the app-wide singleton; this factory is for isolated test instances.
 * @param initial - Optional partial initial state (merged with createAppState defaults)
 * @returns Store instance with getState, subscribe, update, and set methods
 */
export function createStore(initial?: Partial<AppState>): Store {
  let state = createAppState(initial);
  const listeners = new Set<Listener>();

  return {
    getState(): AppState {
      return state;
    },

    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    update(updater: (draft: AppState) => void): void {
      const prev = state;
      // Deep clone to create a draft for mutation (preserves Set objects)
      const draft = deepClone(state);
      updater(draft);
      state = draft;
      for (const fn of listeners) {
        fn(state, prev);
      }
    },

    set<K extends keyof AppState>(key: K, value: AppState[K]): void {
      const prev = state;
      state = { ...state, [key]: value };
      for (const fn of listeners) {
        fn(state, prev);
      }
    },
  };
}

/** Singleton store instance (lazily initialized by getStore). */
let _store: Store | null = null;

/**
 * Initializes the global singleton store with optional initial state.
 * Replaces any existing store. Call once at app startup.
 * @param initial - Optional partial initial state
 * @returns The newly created store instance
 */
export function initStore(initial?: Partial<AppState>): Store {
  _store = createStore(initial);
  return _store;
}

/**
 * Returns the global singleton store.
 * If no store exists yet, creates one with default state.
 * @returns The singleton Store instance
 */
export function getStore(): Store {
  if (!_store) {
    _store = createStore();
  }
  return _store;
}
