import type { ColSourceEntry } from '../types.js';
import { getStore } from '../core/store.js';

export function buildColSourceMap(): Map<string, ColSourceEntry> {
  const state = getStore().getState();
  const map = new Map<string, ColSourceEntry>();

  for (const tid of Object.keys(state.tables)) {
    const cols = state.tables[tid]?.cols || [];
    for (const col of cols) {
      map.set(col, { tid, col });
    }
  }

  for (let i = 0; i < (state.calcStages || []).length; i++) {
    const calc = state.calcStages[i];
    if (calc?.alias) {
      map.set(calc.alias, { kind: 'calc', idx: i, alias: calc.alias });
    }
  }

  return map;
}
