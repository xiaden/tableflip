export const STATE_VERSION = 1;

export const RECOGNIZABLE_KEYS = ['base', 'baseCols', 'stacks', 'lookups', 'calcStages', 'filters', 'sorts', 'colOrder', 'selCols', 'aggMode', 'aggregates', 'colTotals', 'subtotalBy', 'subtotalFns', 'subtotalStrategy'];

export function isRecognizableConfig(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  let matches = 0;
  for (const key of RECOGNIZABLE_KEYS) {
    if (key in payload) matches++;
  }
  return matches >= 2;
}
