export const AGG_FNS = [
  'SUM', 'AVG', 'MIN', 'MAX',
  'COUNT ROWS', 'COUNT NON-EMPTY', 'COUNT DISTINCT',
  'FIRST', 'LAST',
  'DATE RANGE', 'DATE SPAN',
  'NUMERIC RANGE', 'NUMERIC SPAN',
  'LIST',
];

export const AGG_LABELS: Record<string, string> = {
  'SUM':             'Sum',
  'AVG':             'Average',
  'MIN':             'Min value',
  'MAX':             'Max value',
  'COUNT ROWS':      'Count rows',
  'COUNT NON-EMPTY': 'Count non-empty',
  'COUNT DISTINCT':  'Count distinct',
  'FIRST':           'First value',
  'LAST':            'Last value',
  'DATE RANGE':      'Date range  (earliest — latest)',
  'DATE SPAN':       'Date span  (days between)',
  'NUMERIC RANGE':   'Numeric range  (min – max)',
  'NUMERIC SPAN':    'Numeric span  (max − min)',
  'LIST':            'List  (all values joined)',
};

export const AGG_NEEDS_COL = (fn: string): boolean => fn !== 'COUNT ROWS';

export const TOTAL_FNS = [
  'skip', 'SUM', 'AVG', 'MIN', 'MAX',
  'COUNT ROWS', 'COUNT NON-EMPTY', 'COUNT DISTINCT', 'LIST',
];

export const TOTAL_LABELS: Record<string, string> = {
  skip:              'Skip (leave blank)',
  SUM:               'Sum',
  AVG:               'Average',
  MIN:               'Min',
  MAX:               'Max',
  'COUNT ROWS':      'Count rows',
  'COUNT NON-EMPTY': 'Count non-empty',
  'COUNT DISTINCT':  'Count distinct',
  LIST:              'List (all values)',
};

export const SUBTOTAL_FNS = [
  'skip',
  'SUM', 'AVG', 'MIN', 'MAX',
  'COUNT ROWS', 'COUNT NON-EMPTY', 'COUNT DISTINCT',
  'FIRST', 'LAST',
  'DATE RANGE', 'DATE SPAN',
  'NUMERIC RANGE', 'NUMERIC SPAN',
  'LIST',
];

export const SUBTOTAL_LABELS: Record<string, string> = {
  skip:              'Skip (leave blank)',
  SUM:               'Sum',
  AVG:               'Average',
  MIN:               'Min',
  MAX:               'Max',
  'COUNT ROWS':      'Count rows',
  'COUNT NON-EMPTY': 'Count non-empty',
  'COUNT DISTINCT':  'Count distinct',
  FIRST:             'First value',
  LAST:              'Last value',
  'DATE RANGE':      'Date range  (earliest — latest)',
  'DATE SPAN':       'Date span  (days between)',
  'NUMERIC RANGE':   'Numeric range  (min – max)',
  'NUMERIC SPAN':    'Numeric span  (max − min)',
  LIST:              'List (all values)',
};

export const AGG_MODES = ['none', 'group', 'totals', 'subtotals'];

export function getAggregateLabel(fn: string): string {
  return AGG_LABELS[fn] || fn;
}

export function getTotalLabel(fn: string): string {
  return TOTAL_LABELS[fn] || fn;
}

export function getSubtotalLabel(fn: string): string {
  return SUBTOTAL_LABELS[fn] || fn;
}

export function isValidAggregateFn(fn: string): boolean {
  return AGG_FNS.includes(fn);
}

export function isValidTotalFn(fn: string): boolean {
  return TOTAL_FNS.includes(fn);
}

export function isValidSubtotalFn(fn: string): boolean {
  return SUBTOTAL_FNS.includes(fn);
}

export function aggregateNeedsColumn(fn: string): boolean {
  return AGG_NEEDS_COL(fn);
}
