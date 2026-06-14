import { describe, it, expect } from 'vitest';
import {
  buildReportGraph,
  getReportDependencies,
  getReportDependents,
  detectReportCycles,
  getRunOrder,
  getWorkspaceRunOrder,
} from '../../report/report-graph';
import type { ReportSpec, WorkspaceState } from '../../types';
import { createReportSpec, createWorkspaceState } from '../../core/state';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<ReportSpec> = {}): ReportSpec {
  return createReportSpec({
    id: 'report-1',
    name: 'Report 1',
    pipeline: {
      base: 'Orders',
      baseCols: null,
      stacks: [],
      lookups: [],
      calculatedColumns: [],
    },
    publish: { enabled: false, tableName: '' },
    ...overrides,
  });
}

function makeWorkspace(reports: ReportSpec[]): WorkspaceState {
  return createWorkspaceState({ reports });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('report-graph', () => {
  // ── buildReportGraph ─────────────────────────────────────────────────────

  describe('buildReportGraph()', () => {
    it('should return empty graph for null workspace', () => {
      const graph = buildReportGraph(null);
      expect(graph.nodes.size).toBe(0);
      expect(graph.cycles).toEqual([]);
    });

    it('should return empty graph for undefined workspace', () => {
      const graph = buildReportGraph(undefined);
      expect(graph.nodes.size).toBe(0);
      expect(graph.cycles).toEqual([]);
    });

    it('should return empty graph for workspace with no reports', () => {
      const ws = makeWorkspace([]);
      const graph = buildReportGraph(ws);
      expect(graph.nodes.size).toBe(0);
      expect(graph.cycles).toEqual([]);
    });

    it('should create a single node for a single report', () => {
      const report = makeReport({ id: 'r1' });
      const ws = makeWorkspace([report]);
      const graph = buildReportGraph(ws);

      expect(graph.nodes.size).toBe(1);
      const node = graph.nodes.get('r1')!;
      expect(node.report).toBe(report);
      expect(node.dependencies).toEqual([]);
      expect(node.dependents).toEqual([]);
      expect(graph.cycles).toEqual([]);
    });

    it('should create multiple nodes for multiple reports', () => {
      const r1 = makeReport({ id: 'r1' });
      const r2 = makeReport({ id: 'r2' });
      const r3 = makeReport({ id: 'r3' });
      const ws = makeWorkspace([r1, r2, r3]);
      const graph = buildReportGraph(ws);

      expect(graph.nodes.size).toBe(3);
      expect(graph.nodes.has('r1')).toBe(true);
      expect(graph.nodes.has('r2')).toBe(true);
      expect(graph.nodes.has('r3')).toBe(true);
    });

    it('should skip reports with null id', () => {
      const r1 = makeReport({ id: null });
      const ws = makeWorkspace([r1]);
      const graph = buildReportGraph(ws);
      expect(graph.nodes.size).toBe(0);
    });

    it('should create dependency link when report references published output', () => {
      // r1 publishes output, r2 uses r1's output as base table
      const r1 = makeReport({
        id: 'r1',
        publish: { enabled: true, tableName: 'r1_output' },
      });
      const r2 = makeReport({
        id: 'r2',
        pipeline: {
          base: 'r1_output',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
        },
      });
      const ws = makeWorkspace([r1, r2]);
      const graph = buildReportGraph(ws);

      // r2 depends on r1
      expect(graph.nodes.get('r2')!.dependencies).toEqual(['r1']);
      // r1 has r2 as a dependent
      expect(graph.nodes.get('r1')!.dependents).toEqual(['r2']);
    });

    it('should create dependency via lookup rightId', () => {
      const r1 = makeReport({
        id: 'r1',
        publish: { enabled: true, tableName: 'r1_output' },
      });
      const r2 = makeReport({
        id: 'r2',
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: [],
          lookups: [{
            rightId: 'r1_output',
            keyPairs: [{ left: 'Id', right: 'Id' }],
            cols: ['Name'],
            required: false,
            enabled: true,
            duplicatePolicy: { mode: 'block' },
          }],
          calculatedColumns: [],
        },
      });
      const ws = makeWorkspace([r1, r2]);
      const graph = buildReportGraph(ws);

      expect(graph.nodes.get('r2')!.dependencies).toEqual(['r1']);
      expect(graph.nodes.get('r1')!.dependents).toEqual(['r2']);
    });

    it('should create dependency via stack', () => {
      const r1 = makeReport({
        id: 'r1',
        publish: { enabled: true, tableName: 'r1_output' },
      });
      const r2 = makeReport({
        id: 'r2',
        pipeline: {
          base: 'Orders',
          baseCols: null,
          stacks: ['r1_output'],
          lookups: [],
          calculatedColumns: [],
        },
      });
      const ws = makeWorkspace([r1, r2]);
      const graph = buildReportGraph(ws);

      expect(graph.nodes.get('r2')!.dependencies).toEqual(['r1']);
    });

    it('should not create self-dependency when report references its own output', () => {
      const r1 = makeReport({
        id: 'r1',
        publish: { enabled: true, tableName: 'r1_output' },
        pipeline: {
          base: 'r1_output',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
        },
      });
      const ws = makeWorkspace([r1]);
      const graph = buildReportGraph(ws);

      expect(graph.nodes.get('r1')!.dependencies).toEqual([]);
      expect(graph.nodes.get('r1')!.dependents).toEqual([]);
    });

    it('should not create dependency when referenced table is not a published output', () => {
      const r1 = makeReport({
        id: 'r1',
        pipeline: { base: 'Orders', baseCols: null, stacks: [], lookups: [], calculatedColumns: [] },
      });
      const ws = makeWorkspace([r1]);
      const graph = buildReportGraph(ws);

      expect(graph.nodes.get('r1')!.dependencies).toEqual([]);
    });

    it('should not create dependency when publish is disabled', () => {
      const r1 = makeReport({
        id: 'r1',
        publish: { enabled: false, tableName: '' },
      });
      const r2 = makeReport({
        id: 'r2',
        pipeline: {
          base: 'r1_output',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
        },
      });
      const ws = makeWorkspace([r1, r2]);
      const graph = buildReportGraph(ws);

      // r1's output is not published, so no dependency
      expect(graph.nodes.get('r2')!.dependencies).toEqual([]);
    });
  });

  // ── getReportDependencies ────────────────────────────────────────────────

  describe('getReportDependencies()', () => {
    it('should return upstream dependencies for a report', () => {
      const r1 = makeReport({
        id: 'r1',
        publish: { enabled: true, tableName: 'r1_output' },
      });
      const r2 = makeReport({
        id: 'r2',
        pipeline: {
          base: 'r1_output',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
        },
      });
      const ws = makeWorkspace([r1, r2]);
      const graph = buildReportGraph(ws);

      expect(getReportDependencies(graph, 'r2')).toEqual(['r1']);
      expect(getReportDependencies(graph, 'r1')).toEqual([]);
    });

    it('should return empty array for unknown report id', () => {
      const graph = buildReportGraph(makeWorkspace([]));
      expect(getReportDependencies(graph, 'nonexistent')).toEqual([]);
    });
  });

  // ── getReportDependents ──────────────────────────────────────────────────

  describe('getReportDependents()', () => {
    it('should return downstream dependents for a report', () => {
      const r1 = makeReport({
        id: 'r1',
        publish: { enabled: true, tableName: 'r1_output' },
      });
      const r2 = makeReport({
        id: 'r2',
        pipeline: {
          base: 'r1_output',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
        },
      });
      const ws = makeWorkspace([r1, r2]);
      const graph = buildReportGraph(ws);

      expect(getReportDependents(graph, 'r1')).toEqual(['r2']);
      expect(getReportDependents(graph, 'r2')).toEqual([]);
    });

    it('should return empty array for unknown report id', () => {
      const graph = buildReportGraph(makeWorkspace([]));
      expect(getReportDependents(graph, 'nonexistent')).toEqual([]);
    });
  });

  // ── detectReportCycles ───────────────────────────────────────────────────

  describe('detectReportCycles()', () => {
    it('should return empty array when no cycles exist', () => {
      const r1 = makeReport({
        id: 'r1',
        publish: { enabled: true, tableName: 'r1_output' },
      });
      const r2 = makeReport({
        id: 'r2',
        pipeline: {
          base: 'r1_output',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
        },
        publish: { enabled: true, tableName: 'r2_output' },
      });
      const ws = makeWorkspace([r1, r2]);
      const graph = buildReportGraph(ws);

      expect(detectReportCycles(graph)).toEqual([]);
    });

    it('should detect circular dependency A → B → A', () => {
      // A depends on B's output, B depends on A's output
      const rA = makeReport({
        id: 'A',
        pipeline: {
          base: 'B_output',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
        },
        publish: { enabled: true, tableName: 'A_output' },
      });
      const rB = makeReport({
        id: 'B',
        pipeline: {
          base: 'A_output',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
        },
        publish: { enabled: true, tableName: 'B_output' },
      });
      const ws = makeWorkspace([rA, rB]);
      const graph = buildReportGraph(ws);

      expect(graph.cycles.length).toBeGreaterThan(0);
      // The cycle should contain both A and B
      const cycleIds = graph.cycles.flat();
      expect(cycleIds).toContain('A');
      expect(cycleIds).toContain('B');
    });

    it('should detect transitive cycle A → B → C → A', () => {
      const rA = makeReport({
        id: 'A',
        pipeline: {
          base: 'C_output',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
        },
        publish: { enabled: true, tableName: 'A_output' },
      });
      const rB = makeReport({
        id: 'B',
        pipeline: {
          base: 'A_output',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
        },
        publish: { enabled: true, tableName: 'B_output' },
      });
      const rC = makeReport({
        id: 'C',
        pipeline: {
          base: 'B_output',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
        },
        publish: { enabled: true, tableName: 'C_output' },
      });
      const ws = makeWorkspace([rA, rB, rC]);
      const graph = buildReportGraph(ws);

      expect(graph.cycles.length).toBeGreaterThan(0);
      const cycleIds = graph.cycles.flat();
      expect(cycleIds).toContain('A');
      expect(cycleIds).toContain('B');
      expect(cycleIds).toContain('C');
    });
  });

  // ── getRunOrder ──────────────────────────────────────────────────────────

  describe('getRunOrder()', () => {
    it('should return single report for a report with no dependencies', () => {
      const r1 = makeReport({ id: 'r1' });
      const ws = makeWorkspace([r1]);
      const graph = buildReportGraph(ws);

      expect(getRunOrder(graph, 'r1')).toEqual(['r1']);
    });

    it('should return dependencies before the report', () => {
      const r1 = makeReport({
        id: 'r1',
        publish: { enabled: true, tableName: 'r1_output' },
      });
      const r2 = makeReport({
        id: 'r2',
        pipeline: {
          base: 'r1_output',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
        },
        publish: { enabled: true, tableName: 'r2_output' },
      });
      const r3 = makeReport({
        id: 'r3',
        pipeline: {
          base: 'r2_output',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
        },
      });
      const ws = makeWorkspace([r1, r2, r3]);
      const graph = buildReportGraph(ws);

      const order = getRunOrder(graph, 'r3');
      // r1 must come before r2, r2 must come before r3
      expect(order.indexOf('r1')).toBeLessThan(order.indexOf('r2'));
      expect(order.indexOf('r2')).toBeLessThan(order.indexOf('r3'));
      expect(order).toEqual(['r1', 'r2', 'r3']);
    });

    it('should include report itself at the end', () => {
      const r1 = makeReport({ id: 'r1' });
      const ws = makeWorkspace([r1]);
      const graph = buildReportGraph(ws);

      const order = getRunOrder(graph, 'r1');
      expect(order[order.length - 1]).toBe('r1');
    });
  });

  // ── getWorkspaceRunOrder ─────────────────────────────────────────────────

  describe('getWorkspaceRunOrder()', () => {
    it('should return empty array for empty graph', () => {
      const graph = buildReportGraph(makeWorkspace([]));
      expect(getWorkspaceRunOrder(graph)).toEqual([]);
    });

    it('should return all reports in topological order', () => {
      const r1 = makeReport({
        id: 'r1',
        publish: { enabled: true, tableName: 'r1_output' },
      });
      const r2 = makeReport({
        id: 'r2',
        pipeline: {
          base: 'r1_output',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
        },
      });
      const r3 = makeReport({ id: 'r3' }); // independent
      const ws = makeWorkspace([r1, r2, r3]);
      const graph = buildReportGraph(ws);

      const order = getWorkspaceRunOrder(graph);
      expect(order).toHaveLength(3);
      // r1 before r2
      expect(order.indexOf('r1')).toBeLessThan(order.indexOf('r2'));
      // r3 can be anywhere
      expect(order).toContain('r3');
    });

    it('should exclude reports involved in cycles', () => {
      const rA = makeReport({
        id: 'A',
        pipeline: {
          base: 'B_output',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
        },
        publish: { enabled: true, tableName: 'A_output' },
      });
      const rB = makeReport({
        id: 'B',
        pipeline: {
          base: 'A_output',
          baseCols: null,
          stacks: [],
          lookups: [],
          calculatedColumns: [],
        },
        publish: { enabled: true, tableName: 'B_output' },
      });
      const rC = makeReport({ id: 'C' }); // independent
      const ws = makeWorkspace([rA, rB, rC]);
      const graph = buildReportGraph(ws);

      const order = getWorkspaceRunOrder(graph);
      // A and B are in a cycle, should be excluded
      expect(order).not.toContain('A');
      expect(order).not.toContain('B');
      // C is independent, should be included
      expect(order).toContain('C');
    });

    it('should handle independent reports (no dependencies)', () => {
      const r1 = makeReport({ id: 'r1' });
      const r2 = makeReport({ id: 'r2' });
      const r3 = makeReport({ id: 'r3' });
      const ws = makeWorkspace([r1, r2, r3]);
      const graph = buildReportGraph(ws);

      const order = getWorkspaceRunOrder(graph);
      expect(order).toHaveLength(3);
      expect(order).toContain('r1');
      expect(order).toContain('r2');
      expect(order).toContain('r3');
    });
  });
});
