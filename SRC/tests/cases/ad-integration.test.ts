import { describe, it, expect, beforeEach } from 'vitest';

let db: any;
let invalidateValidation: any;
let getValidation: any;
let buildSourceCatalog: any;
let buildQueryPlan: any;
let renderDetailSql: any;
let renderGroupedSql: any;
let renderTotalsSql: any;
let renderSubtotalsSql: any;
let runReport: any;

beforeEach(async () => {
  db = (globalThis as any).db;
  invalidateValidation = (globalThis as any).invalidateValidation || (await import('../../js/report/validation.js')).invalidateValidation;
  
  const valMod = await import('../../js/report/validation.js');
  const catMod = await import('../../js/catalog/source-catalog.js');
  const planMod = await import('../../js/query/query-plan.js');
  const detailMod = await import('../../js/query/sql-detail.js');
  const groupMod = await import('../../js/query/sql-grouped.js');
  const totalsMod = await import('../../js/query/sql-totals.js');
  const subtotalsMod = await import('../../js/query/sql-subtotals.js');
  const engineMod = await import('../../js/report/engine.js');
  
  invalidateValidation = valMod.invalidateValidation;
  getValidation = valMod.getValidation;
  buildSourceCatalog = catMod.buildSourceCatalog;
  buildQueryPlan = planMod.buildQueryPlan;
  renderDetailSql = detailMod.renderDetailSql;
  renderGroupedSql = groupMod.renderGroupedSql;
  renderTotalsSql = totalsMod.renderTotalsSql;
  renderSubtotalsSql = subtotalsMod.renderSubtotalsSql;
  runReport = engineMod.runReport;
});

function runReportPipeline(config: Record<string, any> = {}) {
  if (config.base !== undefined) db.base = config.base;
  if (config.baseCols !== undefined) db.baseCols = config.baseCols;
  if (config.stacks !== undefined) db.stacks = config.stacks;
  if (config.lookups !== undefined) db.lookups = config.lookups;
  if (config.calcStages !== undefined) db.calcStages = config.calcStages;
  if (config.selCols !== undefined) db.selCols = config.selCols;
  if (config.colOrder !== undefined) db.colOrder = config.colOrder;
  if (config.filters !== undefined) db.filters = config.filters;
  if (config.sorts !== undefined) db.sorts = config.sorts;
  if (config.groupBy !== undefined) db.groupBy = config.groupBy;
  if (config.aggregates !== undefined) db.aggregates = config.aggregates;
  if (config.aggMode !== undefined) db.aggMode = config.aggMode;
  if (config.colTotals !== undefined) db.colTotals = config.colTotals;
  if (config.subtotalBy !== undefined) db.subtotalBy = config.subtotalBy;
  if (config.subtotalFns !== undefined) db.subtotalFns = config.subtotalFns;
  if (config.subtotalGrandTotal !== undefined) db.subtotalGrandTotal = config.subtotalGrandTotal;
  if (config.subtotalSpacer !== undefined) db.subtotalSpacer = config.subtotalSpacer;
  if (config.subtotalOnTop !== undefined) db.subtotalOnTop = config.subtotalOnTop;
  if (config.subtotalStrategy !== undefined) db.subtotalStrategy = config.subtotalStrategy;
  if (config.mergedCols !== undefined) db.mergedCols = config.mergedCols;
  if (config.mergeGroupUnderline !== undefined) db.mergeGroupUnderline = config.mergeGroupUnderline;
  if (config.excludedRows !== undefined) db.excludedRows = config.excludedRows;

  invalidateValidation();
  const validation = getValidation();
  const sourceCatalog = buildSourceCatalog();

  let plan: any = null;
  let sql = '';
  let error: string | null = null;

  try {
    plan = buildQueryPlan(null, null, validation, sourceCatalog);
    const mode = plan.aggMode || 'none';
    if (mode === 'group') {
      const result = renderGroupedSql(plan);
      sql = result.sql;
    } else if (mode === 'totals') {
      const detail = renderDetailSql(plan);
      const totals = renderTotalsSql(plan, detail.cols);
      sql = detail.sql;
    } else if (mode === 'subtotals') {
      const result = renderSubtotalsSql(plan);
      sql = result.sql;
    } else {
      const result = renderDetailSql(plan);
      sql = result.sql;
    }
  } catch (e: any) {
    error = e.message;
  }

  let result = null;
  if (!error && validation?.reportStatus !== 'blocked') {
    try {
      result = runReport();
    } catch (e: any) {
      error = e.message;
    }
  }

  return { validation, plan, sql, result, error };
}

function expectReportHealthy(validation: any): void {
  expect(validation, 'validation result should exist').toBeTruthy();
  expect(validation.reportStatus, 'Expected healthy report').toBe('healthy');
}

function findRow(rows: any[], matcher: Record<string, any>): any | null {
  for (const row of rows) {
    let allMatch = true;
    for (const [k, v] of Object.entries(matcher)) {
      if (row[k] !== v) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return row;
  }
  return null;
}

describe('Integration Tests', () => {
  beforeEach(() => {
    db.base = 'Orders';
    db.tables = {
      Orders: { id: 'Orders', name: 'Orders', cols: ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'], rowCount: 8 },
      Contacts: { id: 'Contacts', name: 'Contacts', cols: ['Company', 'Contact', 'Email', 'Phone'], rowCount: 8 },
    };
  });

  describe('detail report with filters and sorts', () => {
    it('should return only Open orders sorted by Amount DESC', () => {
      const r = runReportPipeline({
        base: 'Orders',
        filters: [{ col: 'Status', op: 'equals', val: 'Open', vals: ['Open'], enabled: true }],
        sorts: [{ col: 'Amount', dir: 'DESC', enabled: true }],
        selCols: new Set(['OrderId', 'Company', 'Status', 'Amount']),
        colOrder: ['OrderId', 'Company', 'Status', 'Amount'],
        aggMode: 'none',
      });

      expectReportHealthy(r.validation);
      expect(r.result).toBeTruthy();
      expect(r.result.rows.length).toBe(4);

      for (const row of r.result.rows) {
        expect(row['Status']).toBe('Open');
      }

      const amounts = r.result.rows.map((row: any) => row['Amount'] as number);
      for (let i = 1; i < amounts.length; i++) {
        if (amounts[i - 1] != null && amounts[i] != null) {
          expect(amounts[i - 1] >= amounts[i]).toBe(true);
        }
      }

      expect(amounts[0]).toBe(820);
      expect(amounts[1]).toBe(150);
      expect(amounts[2]).toBe(99.5);
      expect(amounts[3]).toBe(0);
    });
  });

  describe('grouped report with aggregates', () => {
    it('should return one row per company with correct aggregates', () => {
      const r = runReportPipeline({
        base: 'Orders',
        aggMode: 'group',
        groupBy: ['Company'],
        aggregates: [
          { fn: 'SUM', col: 'Amount', alias: 'TotalAmount', enabled: true },
          { fn: 'COUNT ROWS', col: '*', alias: 'OrderCount', enabled: true },
        ],
        selCols: new Set(['Company', 'TotalAmount', 'OrderCount']),
        colOrder: ['Company', 'TotalAmount', 'OrderCount'],
      });

      expectReportHealthy(r.validation);
      expect(r.result).toBeTruthy();
      expect(r.result.rows.length).toBe(5);
      expect(r.result.columns).toContain('Company');
      expect(r.result.columns).toContain('TotalAmount');
      expect(r.result.columns).toContain('OrderCount');

      const acme = findRow(r.result.rows, { Company: 'Acme Corp' });
      expect(acme).toBeTruthy();
      expect(acme['TotalAmount']).toBe(559.5);
      expect(acme['OrderCount']).toBe(3);

      const beta = findRow(r.result.rows, { Company: 'Beta Inc' });
      expect(beta).toBeTruthy();
      expect(beta['OrderCount']).toBe(2);

      const gamma = findRow(r.result.rows, { Company: 'Gamma LLC' });
      expect(gamma).toBeTruthy();
      expect(gamma['TotalAmount']).toBe(500);
      expect(gamma['OrderCount']).toBe(1);

      const delta = findRow(r.result.rows, { Company: 'Delta Co' });
      expect(delta).toBeTruthy();
      expect(delta['TotalAmount']).toBe(0);
      expect(delta['OrderCount']).toBe(1);

      const echo = findRow(r.result.rows, { Company: 'Echo Ltd' });
      expect(echo).toBeTruthy();
      expect(echo['TotalAmount']).toBe(820);
      expect(echo['OrderCount']).toBe(1);
    });
  });

  describe('report with lookup', () => {
    it('should include Email column from Contacts via Company join', () => {
      const r = runReportPipeline({
        base: 'Orders',
        lookups: [{
          rightId: 'Contacts',
          enabled: true,
          keyPairs: [{ left: 'Company', right: 'Company' }],
          required: false,
          cols: ['Email'],
          duplicatePolicy: {
            mode: 'combine',
            combine: { separator: '; ', unique: true, includeBlank: false, sort: false },
          },
        }],
        selCols: new Set(['OrderId', 'Company', 'Email']),
        colOrder: ['OrderId', 'Company', 'Email'],
        aggMode: 'none',
      });

      expectReportHealthy(r.validation);
      expect(r.result).toBeTruthy();
      expect(r.result.columns).toContain('Email');
      expect(r.result.rows.length).toBe(8);

      const ord002 = findRow(r.result.rows, { OrderId: 'ORD-002' });
      expect(ord002).toBeTruthy();
      expect(ord002['Email']).toBe('bob@beta.com');

      const ord007 = findRow(r.result.rows, { OrderId: 'ORD-007' });
      expect(ord007).toBeTruthy();
      expect(ord007['Email']).toBe('echo@echo.com');

      const ord005 = findRow(r.result.rows, { OrderId: 'ORD-005' });
      expect(ord005).toBeTruthy();
      expect(ord005['Email']).toBeNull();
    });
  });

  describe('report with calculated column', () => {
    it('should include calculated column with Amount * 2', () => {
      const r = runReportPipeline({
        base: 'Orders',
        calcStages: [{
          alias: 'DoubleAmount',
          mode: 'math',
          enabled: true,
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'Amount' },
              { type: 'number', value: '2', op: '*' },
            ],
          },
        }],
        selCols: new Set(['OrderId', 'Amount', 'DoubleAmount']),
        colOrder: ['OrderId', 'Amount', 'DoubleAmount'],
        aggMode: 'none',
      });

      expectReportHealthy(r.validation);
      expect(r.result).toBeTruthy();
      expect(r.result.columns).toContain('DoubleAmount');
      expect(r.result.rows.length).toBe(8);

      const ord001 = findRow(r.result.rows, { OrderId: 'ORD-001' });
      expect(ord001).toBeTruthy();
      expect(ord001['Amount']).toBe(150);
      expect(ord001['DoubleAmount']).toBe(300);

      const ord004 = findRow(r.result.rows, { OrderId: 'ORD-004' });
      expect(ord004).toBeTruthy();
      expect(ord004['Amount']).toBe(500);
      expect(ord004['DoubleAmount']).toBe(1000);

      const ord005 = findRow(r.result.rows, { OrderId: 'ORD-005' });
      expect(ord005).toBeTruthy();
      expect(ord005['Amount']).toBe(0);
      expect(ord005['DoubleAmount']).toBe(0);
    });
  });

  describe('totals report', () => {
    it('should include all detail rows and a correct totals row', () => {
      const r = runReportPipeline({
        base: 'Orders',
        aggMode: 'totals',
        colTotals: { Amount: 'SUM' },
        selCols: new Set(['OrderId', 'Amount']),
        colOrder: ['OrderId', 'Amount'],
      });

      expectReportHealthy(r.validation);
      expect(r.result).toBeTruthy();
      expect(r.result.metadata.aggMode).toBe('totals');
      expect(r.result.rows.length).toBe(8);

      const totalsRow = r.result.metadata.totalsRow;
      expect(totalsRow).toBeTruthy();
      expect(totalsRow['Amount']).toBe(2154.5);
    });
  });

  describe('subtotals report', () => {
    it('should include detail rows, subtotal rows, and grand total', () => {
      const r = runReportPipeline({
        base: 'Orders',
        aggMode: 'subtotals',
        subtotalBy: ['Region'],
        subtotalFns: { Amount: 'SUM' },
        selCols: new Set(['Region', 'Amount']),
        colOrder: ['Region', 'Amount'],
      });

      expectReportHealthy(r.validation);
      expect(r.result).toBeTruthy();
      expect(r.result.metadata.aggMode).toBe('subtotals');
      expect(r.result.metadata.hasSubtotals).toBe(true);
      expect(r.result.rows.length).toBeGreaterThan(8);

      const allCols = r.result.metadata.allCols || [];
      expect(allCols).toContain('_row_type');

      const detailRows = r.result.rows.filter((row: any) => row['_row_type'] === 0);
      const subtotalRows = r.result.rows.filter((row: any) => row['_row_type'] === 1);
      const grandTotalRows = r.result.rows.filter((row: any) => row['_row_type'] === 3);

      expect(detailRows.length).toBe(8);
      expect(subtotalRows.length).toBeGreaterThan(0);
      expect(grandTotalRows.length).toBe(1);

      const grandTotal = grandTotalRows[0];
      expect(grandTotal['Amount']).toBe(2154.5);
    });
  });

  describe('complex report with multiple features', () => {
    it('should combine filter, sort, calc, and column selection', () => {
      const r = runReportPipeline({
        base: 'Orders',
        filters: [{ col: 'Region', op: 'equals', val: 'North', vals: ['North'], enabled: true }],
        sorts: [{ col: 'OrderDate', dir: 'ASC', enabled: true }],
        calcStages: [{
          alias: 'AmountTax',
          mode: 'math',
          enabled: true,
          math: {
            strategy: 'stepChain',
            steps: [
              { type: 'column', value: 'Amount' },
              { type: 'number', value: '0.1', op: '*' },
            ],
          },
        }],
        selCols: new Set(['OrderId', 'Company', 'Amount', 'OrderDate', 'AmountTax']),
        colOrder: ['OrderId', 'Company', 'Amount', 'OrderDate', 'AmountTax'],
        aggMode: 'none',
      });

      expectReportHealthy(r.validation);
      expect(r.result).toBeTruthy();
      expect(r.result.rows.length).toBe(3);

      for (const row of r.result.rows) {
        expect(row['OrderDate']).toBeTruthy();
      }

      const dates = r.result.rows.map((row: any) => row['OrderDate']);
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1] <= dates[i]).toBe(true);
      }

      expect(r.result.columns).toContain('AmountTax');

      const ord001 = findRow(r.result.rows, { OrderId: 'ORD-001' });
      expect(ord001).toBeTruthy();
      expect(ord001['Amount']).toBe(150);
      expect(ord001['AmountTax']).toBeCloseTo(15, 5);

      const ord003 = findRow(r.result.rows, { OrderId: 'ORD-003' });
      expect(ord003).toBeTruthy();
      expect(ord003['Amount']).toBe(99.5);
      expect(ord003['AmountTax']).toBeCloseTo(9.95, 5);

      const ord008 = findRow(r.result.rows, { OrderId: 'ORD-008' });
      expect(ord008).toBeTruthy();
      expect(ord008['Amount']).toBe(310);
      expect(ord008['AmountTax']).toBeCloseTo(31, 5);
    });
  });
});
