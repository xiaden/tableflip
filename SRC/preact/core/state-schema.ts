/**
 * State schema version — increment when the saved config format changes.
 */
export const STATE_VERSION = 2;

/**
 * Keys that appear in a recognizable report configuration payload.
 * Used by {@link isRecognizableConfig} to distinguish a valid config
 * from arbitrary JSON.
 */
export const RECOGNIZABLE_KEYS = [
  'base', 'baseCols', 'stacks', 'lookups', 'calcStages',
  'filters', 'sorts', 'colOrder', 'selCols', 'aggMode',
  'aggregates', 'colTotals', 'subtotalBy', 'subtotalFns', 'subtotalStrategy',
  'detailBands',
];

/**
 * Checks whether a parsed JSON payload looks like a report configuration.
 * Returns `true` if the payload is a non-null, non-array object containing
 * at least 2 of the {@link RECOGNIZABLE_KEYS}.
 * @param payload - The raw parsed JSON value to test
 * @returns `true` if the payload is a recognizable config object
 */
export function isRecognizableConfig(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  let matches = 0;
  for (const key of RECOGNIZABLE_KEYS) {
    if (key in payload) matches++;
  }
  return matches >= 2;
}
