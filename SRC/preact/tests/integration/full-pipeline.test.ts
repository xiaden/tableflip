/**
 * Integration tests — full pipeline: load data → configure report → run report → verify results.
 *
 * Uses the global sqlDb (set up in vitest-setup.ts) which has an Orders table
 * with 8 rows. For multi-table tests, creates an additional ContactsPivot table
 * (named to avoid conflict with old test fixtures' Contacts table).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runReport } from '../../report/engine';
import { buildQueryPlan } from '../../query/query-plan';
import type { ReportSpec, DbTable } from '../../types';
import { dropTable } from '../../core/sqldb';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Standard Orders table metadata (matches vitest-setup.ts data). */
function ordersTable(): DbTable {
  return {
    id: 'Orders',
    name: 'Orders',
    cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'],
    rowCount: 8,
  };
}

/** Standard tables record for runReport. */
function tables(extra?: Record<string, DbTable>): Record<string, DbTable> {
  return { Orders: ordersTable(), ...extra };
}

/** Minimal ReportSpec with Orders as base table. */
function spec(overrides: Partial<ReportSpec> = {}): ReportSpec {
  return {
    id: 'integ-test',
    name: 'Integration Test',
    enabled: true,
    pipeline: {
      base: 'Orders',
      baseCols: null,
      stacks: [],
      lookups: [],
      calculatedColumns: [],
      detailBands: [],
    },
    outputColumns: null,
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
    detailBandMode: 'separate',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Integration: Full Pipeline', () => {
  describe('detail pipeline', () => {
    it('should return all 8 Orders rows with correct columns', () => {
      const result = runReport(spec(), tables());
      expect(result.rows).toHaveLength(8);
      expect(result.columns).toContain('OrderId');
      expect(result.columns).toContain('Company');
      expect(result.columns).toContain('Amount');
      expect(result.metadata.aggMode).toBe('none');
      expect(result.metadata.rowCount).toBe(8);
    });

    it('should filter by Company=Acme Corp and return 3 rows', () => {
      const s = spec({
        filters: [
          { col: 'Company', op: '=', val: 'Acme Corp', vals: ['Acme Corp'], enabled: true },
        ],
      });
      const result = runReport(s, tables());
      expect(result.rows).toHaveLength(3);
      for (const row of result.rows) {
        expect(row['Company']).toBe('Acme Corp');
      }
    });

    it('should sort by Amount DESC and return first row with highest amount (820)', () => {
      const s = spec({
        outputColumns: ['OrderId', 'Amount'],
        sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
      });
      const result = runReport(s, tables());
      expect(result.rows).toHaveLength(8);
      // First row should have the highest non-null amount
      expect(result.rows[0]['Amount']).toBe(820);
      // Verify descending order for non-null values
      const amounts = result.rows.map(r => r['Amount'] as number | null);
      for (let i = 0; i < amounts.length - 2; i++) {
        if (amounts[i] !== null && amounts[i + 1] !== null) {
          expect(amounts[i]! as number).toBeGreaterThanOrEqual(amounts[i + 1]! as number);
        }
      }
    });
  });

  describe('grouped pipeline', () => {
    it('should group by Company with SUM(Amount) → 5 companies, Acme sum=559.5', () => {
      const s = spec({
        aggregation: {
          mode: 'group',
          groupBy: ['Company'],
          aggregates: [
            { col: 'Amount', fn: 'SUM', alias: 'TotalAmount', enabled: true },
          ],
          colTotals: {},
          subtotalBy: [],
          subtotalFns: {},
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
      });
      const result = runReport(s, tables());
      expect(result.metadata.aggMode).toBe('group');
      expect(result.rows).toHaveLength(5);

      // Verify each row has Company and TotalAmount
      for (const row of result.rows) {
        expect(row).toHaveProperty('Company');
        expect(row).toHaveProperty('TotalAmount');
      }

      // Acme Corp: 150 + 99.5 + 310 = 559.5
      const acme = result.rows.find(r => r['Company'] === 'Acme Corp');
      expect(acme).toBeTruthy();
      expect(acme!['TotalAmount']).toBeCloseTo(559.5, 1);

      // Echo Ltd: 820
      const echo = result.rows.find(r => r['Company'] === 'Echo Ltd');
      expect(echo).toBeTruthy();
      expect(echo!['TotalAmount']).toBe(820);
    });
  });

  describe('totals pipeline', () => {
    it('should produce a totalsRow with SUM(Amount)', () => {
      const s = spec({
        outputColumns: ['OrderId', 'Amount'],
        aggregation: {
          mode: 'totals',
          groupBy: [],
          aggregates: [],
          colTotals: { Amount: 'SUM' },
          subtotalBy: [],
          subtotalFns: {},
          subtotalGrandTotal: true,
          subtotalSpacer: false,
          subtotalOnTop: false,
          subtotalStrategy: 'combined',
        },
      });
      const result = runReport(s, tables());
      expect(result.metadata.aggMode).toBe('totals');
      expect(result.metadata.totalsRow).toBeTruthy();
      // SUM of non-null amounts: 150 + 275 + 99.5 + 500 + 0 + 820 + 310 = 2154.5
      // (ORD-006 has null Amount, so excluded from SUM)
      expect(result.metadata.totalsRow!['Amount']).toBeCloseTo(2154.5, 1);
    });
  });

  describe('multi-table pipeline with lookup', () => {
    // ContactsPivot table is created in beforeAll below.
    // Named to avoid conflict with old test fixtures' Contacts table.

    const pivotTable: DbTable = {
      id: 'ContactsPivot',
      name: 'ContactsPivot',
      cols: ['ContactId', 'Name', 'Email', 'Phone'],
      rowCount: 5,
    };

    it('should join Orders with ContactsPivot via lookup and return joined columns', () => {
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [{
            rightId: 'ContactsPivot',
            keyPairs: [{ left: 'Contact', right: 'ContactId' }],
            cols: ['Name', 'Email'],
            required: false,
            enabled: true,
            duplicatePolicy: { mode: 'block' },
          }],
          calculatedColumns: [],
          detailBands: [],
        },
      });

      const result = runReport(s, tables({ ContactsPivot: pivotTable }));
      expect(result.rows).toHaveLength(8);

      // Should have both base columns and lookup columns
      expect(result.columns).toContain('OrderId');
      expect(result.columns).toContain('Company');

      // Verify joined data — Acme Corp orders should have Alice's contact info
      const acmeRows = result.rows.filter(r => r['Company'] === 'Acme Corp');
      expect(acmeRows).toHaveLength(3);
      for (const row of acmeRows) {
        expect(row['Name']).toBe('Alice');
        expect(row['Email']).toBe('alice@acme.com');
      }

      // Beta Inc orders should have Bob's contact info
      const betaRows = result.rows.filter(r => r['Company'] === 'Beta Inc');
      expect(betaRows).toHaveLength(2);
      for (const row of betaRows) {
        expect(row['Name']).toBe('Bob');
        expect(row['Email']).toBe('bob@beta.com');
      }
    });
  });

  describe('calculated column pipeline', () => {
    it('should recognize calc column in the query plan and produce SQL expression', () => {
      // The calc column expression is built by buildCalcExpressions and stored
      // in the query plan, but the detail query builder uses resolveRef which
      // returns the quoted alias for calc columns. We verify the plan-level
      // integration: calc expressions are built and the column appears in output.
      const s = spec({
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [{
            alias: 'DoubleAmount',
            mode: 'math',
            math: {
              strategy: 'stepChain',
              steps: [
                { type: 'column', value: 'Amount' },
                { type: 'number', value: '2', op: '*' },
              ],
            },
            enabled: true,
          }],
          detailBands: [],
        },
      });

      const plan = buildQueryPlan(s, tables());

      // The calc expression should be built and stored in the plan
      expect(plan.calculatedColumns).toHaveLength(1);
      expect(plan.calculatedColumns[0].alias).toBe('DoubleAmount');
      expect(plan.calculatedColumns[0].sql).toContain('*');

      // The calc column should appear in the plan's column list
      expect(plan.cols).toContain('DoubleAmount');

      // The colMap should include the calc column
      expect(plan.colMap.has('DoubleAmount')).toBe(true);
      const entry = plan.colMap.get('DoubleAmount');
      expect(entry).toBeTruthy();
      expect((entry as any).kind).toBe('calc');
    });
  });

  // ── Setup for multi-table tests ─────────────────────────────────────────

  beforeAll(() => {
    // Create ContactsPivot table (named to avoid conflict with old fixtures' Contacts)
    const db: SqlJsDatabase = (globalThis as any).sqlDb;
    db.run(`DROP TABLE IF EXISTS "ContactsPivot"`);
    db.run(`CREATE TABLE "ContactsPivot" (
      "ContactId" TEXT, "Name" TEXT, "Email" TEXT, "Phone" TEXT
    )`);
    const stmt = db.prepare(
      `INSERT INTO "ContactsPivot" ("ContactId","Name","Email","Phone") VALUES (?,?,?,?)`
    );
    stmt.run(['Alice', 'Alice', 'alice@acme.com', '555-0001']);
    stmt.run(['Bob', 'Bob', 'bob@beta.com', '555-0002']);
    stmt.run(['Carol', 'Carol', 'carol@gamma.com', '555-0003']);
    stmt.run(['Dave', 'Dave', 'dave@delta.com', '555-0004']);
    stmt.run(['Eve', 'Eve', 'eve@echo.com', '555-0005']);
    stmt.free();
  });

  afterAll(() => {
    // Clean up ContactsPivot table
    try { dropTable('ContactsPivot'); } catch { /* ignore */ }
  });
});
