import type { AppState } from '../types.js';
import { createAppState } from './state.js';

type Listener = (state: AppState, prev: AppState) => void;

export interface Store {
  getState(): AppState;
  subscribe(listener: Listener): () => void;
  update(partial: Partial<AppState>): void;
  set(state: AppState): void;
}

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

    update(partial: Partial<AppState>): void {
      const prev = state;
      state = { ...state, ...partial };
      for (const fn of listeners) {
        fn(state, prev);
      }
    },

    set(next: AppState): void {
      const prev = state;
      state = next;
      for (const fn of listeners) {
        fn(state, prev);
      }
    },
  };
}

let _store: Store | null = null;

export function initStore(initial?: Partial<AppState>): Store {
  _store = createStore(initial);
  return _store;
}

export function getStore(): Store {
  if (!_store) {
    _store = createStore();
  }
  return _store;
}
