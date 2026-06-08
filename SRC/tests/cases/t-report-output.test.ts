import { describe, it, expect } from 'vitest';
import {
  publishReportOutput,
  buildPublishedOutputCatalog,
} from '../../js/report/report-output.js';
import { buildResultSet } from '../../js/report/result-set.js';

describe('Report Output', () => {
  describe('publishReportOutput', () => {
    it('should publish output with report id and name', () => {
      const spec = { id: 'r1', name: 'Sales Report' };
      const rs = buildResultSet(['Col1', 'Col2'], [{ Col1: 'a', Col2: 1 }]);
      const output = publishReportOutput(spec, rs);
      expect(output.reportId).toBe('r1');
      expect(output.outputId).toBe('r1_output');
      expect(output.name).toBe('Sales Report (output)');
      expect(output.source).toBe('report');
      expect(typeof output.publishedAt).toBe('number');
    });

    it('should use default id when report has no id', () => {
      const spec = { name: 'NoId' };
      const rs = buildResultSet(['A'], [{ A: 1 }]);
      const output = publishReportOutput(spec, rs);
      expect(output.reportId).toBe('default');
      expect(output.outputId).toBe('default_output');
    });

    it('should use default name when report has no name', () => {
      const spec = { id: 'r1' };
      const rs = buildResultSet(['A'], [{ A: 1 }]);
      const output = publishReportOutput(spec, rs);
      expect(output.name).toBe('Report (output)');
    });

    it('should include columns from result set', () => {
      const spec = { id: 'r1', name: 'Test' };
      const rs = buildResultSet(['X', 'Y', 'Z'], [{ X: 1, Y: 2, Z: 3 }]);
      const output = publishReportOutput(spec, rs);
      expect(output.columns).toEqual(['X', 'Y', 'Z']);
    });

    it('should use displayCols from metadata when available', () => {
      const spec = { id: 'r1', name: 'Test' };
      const rs = buildResultSet(
        ['X', 'Y', 'Z'],
        [{ X: 1, Y: 2, Z: 3 }],
        { displayCols: ['X', 'Z'] }
      );
      const output = publishReportOutput(spec, rs);
      expect(output.columns).toEqual(['X', 'Z']);
    });

    it('should filter out non-data rows (_row_type !== 0)', () => {
      const spec = { id: 'r1', name: 'Test' };
      const rs = buildResultSet(
        ['A'],
        [
          { A: 1 },
          { A: 2, _row_type: 1 },
          { A: 3 },
          { A: 4, _row_type: 2 },
        ]
      );
      const output = publishReportOutput(spec, rs);
      expect(output.rows.length).toBe(2);
      expect(output.rows[0].A).toBe(1);
      expect(output.rows[1].A).toBe(3);
    });

    it('should keep rows with _row_type === 0', () => {
      const spec = { id: 'r1', name: 'Test' };
      const rs = buildResultSet(
        ['A'],
        [{ A: 1, _row_type: 0 }, { A: 2 }]
      );
      const output = publishReportOutput(spec, rs);
      expect(output.rows.length).toBe(2);
    });

    it('should handle empty rows', () => {
      const spec = { id: 'r1', name: 'Test' };
      const rs = buildResultSet(['A', 'B'], []);
      const output = publishReportOutput(spec, rs);
      expect(output.rows).toEqual([]);
      expect(output.columns).toEqual(['A', 'B']);
    });
  });

  describe('buildPublishedOutputCatalog', () => {
    it('should return empty catalog for empty reports', () => {
      const catalog = buildPublishedOutputCatalog({ reports: [] }, new Map());
      expect(catalog.size).toBe(0);
    });

    it('should return empty catalog for null workspaceState', () => {
      const catalog = buildPublishedOutputCatalog(null as any, new Map());
      expect(catalog.size).toBe(0);
    });

    it('should skip reports without publish.enabled', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'NoPublish' },
          { id: 'r2', name: 'Disabled', publish: { enabled: false } },
        ],
      };
      const rs1 = buildResultSet(['A'], [{ A: 1 }]);
      const rs2 = buildResultSet(['A'], [{ A: 2 }]);
      const cache = new Map([['r1', rs1], ['r2', rs2]]);
      const catalog = buildPublishedOutputCatalog(ws, cache);
      expect(catalog.size).toBe(0);
    });

    it('should skip reports with no result set in cache', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'Missing', publish: { enabled: true } },
        ],
      };
      const catalog = buildPublishedOutputCatalog(ws, new Map());
      expect(catalog.size).toBe(0);
    });

    it('should build catalog entries for published reports with results', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'Report A', publish: { enabled: true } },
          { id: 'r2', name: 'Report B', publish: { enabled: true } },
        ],
      };
      const rs1 = buildResultSet(['X'], [{ X: 1 }]);
      const rs2 = buildResultSet(['Y'], [{ Y: 2 }]);
      const cache = new Map([['r1', rs1], ['r2', rs2]]);
      const catalog = buildPublishedOutputCatalog(ws, cache);
      expect(catalog.size).toBe(2);
      expect(catalog.has('r1_output')).toBe(true);
      expect(catalog.has('r2_output')).toBe(true);
    });

    it('should handle mixed published and unpublished reports', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'Published', publish: { enabled: true } },
          { id: 'r2', name: 'NotPublished' },
          { id: 'r3', name: 'AlsoPublished', publish: { enabled: true } },
        ],
      };
      const rs1 = buildResultSet(['A'], [{ A: 1 }]);
      const rs3 = buildResultSet(['B'], [{ B: 2 }]);
      const cache = new Map([['r1', rs1], ['r3', rs3]]);
      const catalog = buildPublishedOutputCatalog(ws, cache);
      expect(catalog.size).toBe(2);
      expect(catalog.has('r1_output')).toBe(true);
      expect(catalog.has('r3_output')).toBe(true);
    });

    it('should handle null resultCache gracefully', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'Report', publish: { enabled: true } },
        ],
      };
      const catalog = buildPublishedOutputCatalog(ws, null as any);
      expect(catalog.size).toBe(0);
    });
  });
});
