import { describe, it, expect } from 'vitest';
import {
  buildReportGraph,
  getReportDependencies,
  getReportDependents,
  detectReportCycles,
  getRunOrder,
  getWorkspaceRunOrder,
} from '../../js/report/report-graph.js';

describe('Report Graph', () => {
  describe('buildReportGraph', () => {
    it('should return empty graph for null workspaceState', () => {
      const graph = buildReportGraph(null);
      expect(graph.nodes.size).toBe(0);
      expect(graph.cycles).toEqual([]);
    });

    it('should return empty graph for undefined workspaceState', () => {
      const graph = buildReportGraph(undefined);
      expect(graph.nodes.size).toBe(0);
      expect(graph.cycles).toEqual([]);
    });

    it('should return empty graph when reports is empty', () => {
      const graph = buildReportGraph({ reports: [] });
      expect(graph.nodes.size).toBe(0);
      expect(graph.cycles).toEqual([]);
    });

    it('should create nodes for each report', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'Report 1' },
          { id: 'r2', name: 'Report 2' },
        ],
      };
      const graph = buildReportGraph(ws);
      expect(graph.nodes.size).toBe(2);
      expect(graph.nodes.has('r1')).toBe(true);
      expect(graph.nodes.has('r2')).toBe(true);
    });

    it('should link dependencies via pipeline.base to published output', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'Base', publish: { enabled: true } },
          { id: 'r2', name: 'Child', pipeline: { base: 'r1_output' } },
        ],
      };
      const graph = buildReportGraph(ws);
      expect(getReportDependencies(graph, 'r2')).toEqual(['r1']);
      expect(getReportDependents(graph, 'r1')).toEqual(['r2']);
    });

    it('should link dependencies via pipeline.stacks to published output', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'Stack', publish: { enabled: true } },
          { id: 'r2', name: 'Child', pipeline: { stacks: ['r1_output'] } },
        ],
      };
      const graph = buildReportGraph(ws);
      expect(getReportDependencies(graph, 'r2')).toEqual(['r1']);
      expect(getReportDependents(graph, 'r1')).toEqual(['r2']);
    });

    it('should link dependencies via pipeline.lookups rightId to published output', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'Lookup', publish: { enabled: true } },
          { id: 'r2', name: 'Child', pipeline: { lookups: [{ rightId: 'r1_output' }] } },
        ],
      };
      const graph = buildReportGraph(ws);
      expect(getReportDependencies(graph, 'r2')).toEqual(['r1']);
    });

    it('should skip self-references', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'Self', publish: { enabled: true }, pipeline: { base: 'r1_output' } },
        ],
      };
      const graph = buildReportGraph(ws);
      expect(getReportDependencies(graph, 'r1')).toEqual([]);
    });

    it('should skip references to non-published reports', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'NotPublished', publish: { enabled: false } },
          { id: 'r2', name: 'Child', pipeline: { base: 'r1_output' } },
        ],
      };
      const graph = buildReportGraph(ws);
      expect(getReportDependencies(graph, 'r2')).toEqual([]);
    });

    it('should skip references to unknown outputs', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'Report', pipeline: { base: 'nonexistent_output' } },
        ],
      };
      const graph = buildReportGraph(ws);
      expect(getReportDependencies(graph, 'r1')).toEqual([]);
    });

    it('should not duplicate dependencies', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'Base', publish: { enabled: true } },
          { id: 'r2', name: 'Child', pipeline: { base: 'r1_output', stacks: ['r1_output'] } },
        ],
      };
      const graph = buildReportGraph(ws);
      expect(getReportDependencies(graph, 'r2')).toEqual(['r1']);
    });
  });

  describe('getReportDependencies', () => {
    it('should return empty array for unknown report', () => {
      const graph = buildReportGraph({ reports: [] });
      expect(getReportDependencies(graph, 'unknown')).toEqual([]);
    });

    it('should return dependencies for a report', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'A', publish: { enabled: true } },
          { id: 'r2', name: 'B', publish: { enabled: true } },
          { id: 'r3', name: 'C', pipeline: { base: 'r1_output', stacks: ['r2_output'] } },
        ],
      };
      const graph = buildReportGraph(ws);
      const deps = getReportDependencies(graph, 'r3');
      expect(deps).toContain('r1');
      expect(deps).toContain('r2');
      expect(deps.length).toBe(2);
    });
  });

  describe('getReportDependents', () => {
    it('should return empty array for unknown report', () => {
      const graph = buildReportGraph({ reports: [] });
      expect(getReportDependents(graph, 'unknown')).toEqual([]);
    });

    it('should return dependents for a report', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'Base', publish: { enabled: true } },
          { id: 'r2', name: 'Child1', pipeline: { base: 'r1_output' } },
          { id: 'r3', name: 'Child2', pipeline: { stacks: ['r1_output'] } },
        ],
      };
      const graph = buildReportGraph(ws);
      const deps = getReportDependents(graph, 'r1');
      expect(deps).toContain('r2');
      expect(deps).toContain('r3');
      expect(deps.length).toBe(2);
    });
  });

  describe('detectReportCycles', () => {
    it('should return empty array when no cycles', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'A', publish: { enabled: true } },
          { id: 'r2', name: 'B', pipeline: { base: 'r1_output' } },
        ],
      };
      const graph = buildReportGraph(ws);
      expect(detectReportCycles(graph)).toEqual([]);
    });

    it('should detect cycles in dependencies', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'A', publish: { enabled: true }, pipeline: { base: 'r2_output' } },
          { id: 'r2', name: 'B', publish: { enabled: true }, pipeline: { base: 'r1_output' } },
        ],
      };
      const graph = buildReportGraph(ws);
      const cycles = detectReportCycles(graph);
      expect(cycles.length).toBeGreaterThan(0);
    });
  });

  describe('getRunOrder', () => {
    it('should return single report when no dependencies', () => {
      const ws = { reports: [{ id: 'r1', name: 'A' }] };
      const graph = buildReportGraph(ws);
      expect(getRunOrder(graph, 'r1')).toEqual(['r1']);
    });

    it('should return dependencies before the report', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'A', publish: { enabled: true } },
          { id: 'r2', name: 'B', publish: { enabled: true } },
          { id: 'r3', name: 'C', pipeline: { base: 'r1_output', stacks: ['r2_output'] } },
        ],
      };
      const graph = buildReportGraph(ws);
      const order = getRunOrder(graph, 'r3');
      expect(order.indexOf('r1')).toBeLessThan(order.indexOf('r3'));
      expect(order.indexOf('r2')).toBeLessThan(order.indexOf('r3'));
      expect(order).toContain('r1');
      expect(order).toContain('r2');
      expect(order).toContain('r3');
    });

    it('should return empty-like for unknown report', () => {
      const graph = buildReportGraph({ reports: [] });
      expect(getRunOrder(graph, 'unknown')).toEqual(['unknown']);
    });

    it('should handle chained dependencies', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'A', publish: { enabled: true } },
          { id: 'r2', name: 'B', publish: { enabled: true }, pipeline: { base: 'r1_output' } },
          { id: 'r3', name: 'C', pipeline: { base: 'r2_output' } },
        ],
      };
      const graph = buildReportGraph(ws);
      const order = getRunOrder(graph, 'r3');
      expect(order.indexOf('r1')).toBeLessThan(order.indexOf('r2'));
      expect(order.indexOf('r2')).toBeLessThan(order.indexOf('r3'));
    });
  });

  describe('getWorkspaceRunOrder', () => {
    it('should return all reports in dependency order', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'A', publish: { enabled: true } },
          { id: 'r2', name: 'B', pipeline: { base: 'r1_output' } },
        ],
      };
      const graph = buildReportGraph(ws);
      const order = getWorkspaceRunOrder(graph);
      expect(order.indexOf('r1')).toBeLessThan(order.indexOf('r2'));
    });

    it('should exclude reports involved in cycles', () => {
      const ws = {
        reports: [
          { id: 'r1', name: 'A', publish: { enabled: true }, pipeline: { base: 'r2_output' } },
          { id: 'r2', name: 'B', publish: { enabled: true }, pipeline: { base: 'r1_output' } },
          { id: 'r3', name: 'C', publish: { enabled: true } },
        ],
      };
      const graph = buildReportGraph(ws);
      const order = getWorkspaceRunOrder(graph);
      expect(order).toContain('r3');
      expect(order).not.toContain('r1');
      expect(order).not.toContain('r2');
    });

    it('should return empty array for no reports', () => {
      const graph = buildReportGraph({ reports: [] });
      expect(getWorkspaceRunOrder(graph)).toEqual([]);
    });
  });
});
