import { quoteId } from './sqldb.js';

export type DateComponent = 'D' | 'DD' | 'M' | 'MM' | 'MMM' | 'YY' | 'YYYY';

export interface DateInputFormat {
  first: DateComponent;
  second: DateComponent;
  third: DateComponent;
}

function componentWidth(c: string): number {
  switch (c) {
    case 'D': case 'M': return 1;
    case 'DD': case 'MM': case 'YY': return 2;
    case 'MMM': return 3;
    case 'YYYY': return 4;
    default: return 2;
  }
}

function isMonth(c: string): boolean { return c.startsWith('M'); }
function isDay(c: string): boolean { return c.startsWith('D'); }
function isYear(c: string): boolean { return c.startsWith('Y'); }

function monthToNumExpr(expr: string): string {
  return `(CASE UPPER(${expr}) WHEN 'JAN' THEN '01' WHEN 'FEB' THEN '02' WHEN 'MAR' THEN '03' WHEN 'APR' THEN '04' WHEN 'MAY' THEN '05' WHEN 'JUN' THEN '06' WHEN 'JUL' THEN '07' WHEN 'AUG' THEN '08' WHEN 'SEP' THEN '09' WHEN 'OCT' THEN '10' WHEN 'NOV' THEN '11' WHEN 'DEC' THEN '12' ELSE '01' END)`;
}

/**
 * Generate a SQL expression that converts a date string to ISO format (YYYY-MM-DD).
 * The date string is expected to have three components separated by a single-character separator.
 * The format specifies what each component represents.
 */
export function normalizeDateExpr(colExpr: string, format: DateInputFormat | null | undefined): string {
  if (!format) return colExpr;

  const w1 = componentWidth(format.first);
  const w2 = componentWidth(format.second);
  const w3 = componentWidth(format.third);

  // Fixed positions: component 1 starts at 1, component 2 after separator, component 3 after separator
  const p1 = 1;
  const p2 = p1 + w1 + 1; // +1 for separator
  const p3 = p2 + w2 + 1;

  const extract = (pos: number, width: number) => `substr(${colExpr}, ${pos}, ${width})`;
  const v1 = extract(p1, w1);
  const v2 = extract(p2, w2);
  const v3 = extract(p3, w3);

  // Map each position to its role
  const parts = [
    { comp: format.first, expr: v1 },
    { comp: format.second, expr: v2 },
    { comp: format.third, expr: v3 },
  ];

  const yearPart = parts.find(p => isYear(p.comp));
  const monthPart = parts.find(p => isMonth(p.comp));
  const dayPart = parts.find(p => isDay(p.comp));

  if (!yearPart || !monthPart || !dayPart) return colExpr;

  // Year expression
  let yearExpr = yearPart.expr;
  if (yearPart.comp === 'YY') yearExpr = `'20' || ${yearExpr}`;

  // Month expression
  let monthExpr = monthPart.expr;
  if (monthPart.comp === 'MMM') monthExpr = monthToNumExpr(monthExpr);
  else if (monthPart.comp === 'M') monthExpr = `printf('%02d', CAST(${monthExpr} AS INTEGER))`;

  // Day expression
  let dayExpr = dayPart.expr;
  if (dayPart.comp === 'D') dayExpr = `printf('%02d', CAST(${dayExpr} AS INTEGER))`;

  return `${yearExpr} || '-' || ${monthExpr} || '-' || ${dayExpr}`;
}

/**
 * Get the default input format for a date calc stage.
 * Returns null if no format is configured.
 */
export function getDateInputFormat(date: { inputFormat?: DateInputFormat } | undefined): DateInputFormat | null {
  if (!date?.inputFormat) return null;
  const { first, second, third } = date.inputFormat;
  if (!first || !second || !third) return null;
  return { first, second, third };
}
