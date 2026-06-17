/**
 * Shared test helpers for query-layer tests.
 */
import type { ColMapEntry } from '../../catalog/column-catalog';
import type { SourceTableEntry } from '../../catalog/source-catalog';
import type { ReportSpec, DbTable } from '../../types';

/** Normalize SQL whitespace for comparison: collapse runs of whitespace to single space, trim. */
export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

/** Check that SQL contains a substring (after normalization). */
export function sqlContains(sql: string, ...substrings: string[]): boolean {
  const norm = normalizeSql(sql);
  return substrings.every(s => norm.includes(normalizeSql(s)));
}

/**
 * Standard colMap for Orders table columns.
 *
 * Includes colType metadata for type-aware WHERE tests:
 * - Amount → colType: 'number'
 * - OrderDate → colType: 'date'
 * - Other columns have no colType (defaults to 'string')
 */
export function ordersColMap(): Map<string, ColMapEntry> {
  return new Map<string, ColMapEntry>([
    ['OrderId', { tid: 'Orders', col: 'OrderId' }],
    ['Company', { tid: 'Orders', col: 'Company' }],
    ['Contact', { tid: 'Orders', col: 'Contact' }],
    ['Status', { tid: 'Orders', col: 'Status' }],
    ['Amount', { tid: 'Orders', col: 'Amount', colType: 'number' }],
    ['OrderDate', { tid: 'Orders', col: 'OrderDate', colType: 'date' }],
    ['ShipDate', { tid: 'Orders', col: 'ShipDate', colType: 'date' }],
    ['TermMonths', { tid: 'Orders', col: 'TermMonths', colType: 'number' }],
    ['Region', { tid: 'Orders', col: 'Region' }],
  ]);
}

/** Standard sourceCatalog with Orders and Contacts tables. */
export function standardSourceCatalog(): Map<string, SourceTableEntry> {
  return new Map<string, SourceTableEntry>([
    ['Orders', {
      id: 'Orders',
      name: 'Orders',
      cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'],
      kind: 'imported',
      source: { id: 'Orders', name: 'Orders', cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'], rowCount: 8, colTypes: { OrderId: 'number', Amount: 'number', OrderDate: 'date', Company: 'string', Contact: 'string', Status: 'string', Region: 'string' } },
    }],
    ['Contacts', {
      id: 'Contacts',
      name: 'Contacts',
      cols: ['ContactId', 'Name', 'Email', 'Phone'],
      kind: 'imported',
      source: { id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name', 'Email', 'Phone'], rowCount: 5, colTypes: { ContactId: 'number', Name: 'string', Email: 'string', Phone: 'string' } },
    }],
  ]);
}

/** Minimal ReportSpec factory. */
export function makeReportSpec(overrides: Partial<ReportSpec> = {}): ReportSpec {
  return {
    id: 'test-report',
    name: 'Test Report',
    enabled: true,
    pipeline: {
      base: 'Orders',
      baseCols: [],
      stacks: [],
      lookups: [],
      calculatedColumns: [],
      detailBands: [],
    },
    outputColumns: [],
    filters: [],
    sorts: [],
    aggregation: {
      mode: 'none',
      groupBy: [],
      aggregates: [],
      colTotals: {},
      subtotalBy: [],
      subtotalFns: {},
      subtotalGrandTotal: true,
      subtotalSpacer: false,
      subtotalOnTop: false,
      subtotalStrategy: 'combined',
    },
    mergeDisplay: { mergedCols: [], mergeGroupUnderline: false },
    outputDefinition: null,
    publish: { enabled: false, tableName: '' },
    ...overrides,
  };
}

/** Standard tables record for buildQueryPlan. */
export function standardTables(): Record<string, DbTable> {
  return {
    Orders: { id: 'Orders', name: 'Orders', cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'], rowCount: 8, colTypes: { OrderId: 'number', Amount: 'number', OrderDate: 'date', Company: 'string', Contact: 'string', Status: 'string', Region: 'string' } },
    Contacts: { id: 'Contacts', name: 'Contacts', cols: ['ContactId', 'Name', 'Email', 'Phone'], rowCount: 5, colTypes: { ContactId: 'number', Name: 'string', Email: 'string', Phone: 'string' } },
  };
}
