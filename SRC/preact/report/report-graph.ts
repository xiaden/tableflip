/**
 * Report dependency graph.
 *
 * Builds a directed graph of report-to-report dependencies based on
 * published output tables.  Reports that reference another report's
 * published output create an edge in the graph.
 *
 * Pure functions — no global state dependency.
 *
 * Ported from SRC/js/report/report-graph.ts — zero imports from SRC/js/.
 */

import type { WorkspaceState, ReportSpec } from '../types';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * A single node in the report dependency graph.
 * @property report - The report specification this node represents
 * @property dependencies - IDs of reports this report depends on (upstream)
 * @property dependents - IDs of reports that depend on this report (downstream)
 */
export interface ReportNode {
  report: ReportSpec;
  dependencies: string[];
  dependents: string[];
}

/**
 * The full dependency graph plus detected cycles.
 * @property nodes - Map from report ID to its graph node (report + edges)
 * @property cycles - Array of detected dependency cycles, each an array of report IDs
 */
export interface ReportGraph {
  nodes: Map<string, ReportNode>;
  cycles: string[][];
}

// ── Graph Builder ──────────────────────────────────────────────────────────────

/**
 * Build a {@link ReportGraph} from the workspace state.
 *
 * Each report becomes a node.  Dependencies are derived from the
 * pipeline's base table, stacks, and lookup right-ids — if any of
 * those match another report's published output table name, an edge
 * is created.  Cycles are detected via DFS.
 *
 * @param workspaceState - The full workspace state (may be null/undefined)
 * @returns A graph with nodes, edges, and detected cycles
 */
export function buildReportGraph(workspaceState?: WorkspaceState | null): ReportGraph {
  const reports = workspaceState?.reports ?? [];
  const nodes   = new Map<string, ReportNode>();

  // 1. Create a node for every report
  for (const report of reports) {
    if (report.id != null) {
      nodes.set(report.id, { report, dependencies: [], dependents: [] });
    }
  }

  // 2. Map published output table names → report IDs
  //    A report's published output is accessed via its ID + '_output'.
  const outputToReport = new Map<string, string>();
  for (const report of reports) {
    if (report.id != null && report.publish?.enabled) {
      outputToReport.set(report.id + '_output', report.id);
    }
  }

  // 3. Resolve dependencies: pipeline refs that match a published output
  for (const report of reports) {
    if (report.id == null) continue;
    const node     = nodes.get(report.id)!;
    const pipeline = report.pipeline;
    const refs: string[] = [
      pipeline.base,
      ...pipeline.stacks,
      ...pipeline.lookups.map(l => l.rightId),
      ...(pipeline.detailBands || []).map(b => b.rightId),
    ].filter(Boolean) as string[];

    for (const ref of refs) {
      const depId = outputToReport.get(ref);
      if (!depId || depId === report.id) continue;
      if (!node.dependencies.includes(depId)) node.dependencies.push(depId);
      const depNode = nodes.get(depId);
      if (depNode && !depNode.dependents.includes(report.id)) {
        depNode.dependents.push(report.id);
      }
    }
  }

  // 4. Detect cycles via DFS
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  function dfs(id: string): void {
    if (inStack.has(id)) {
      const start = path.indexOf(id);
      if (start >= 0) cycles.push([...path.slice(start), id]);
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    inStack.add(id);
    path.push(id);
    const node = nodes.get(id);
    if (node) {
      for (const dep of node.dependencies) dfs(dep);
    }
    path.pop();
    inStack.delete(id);
  }

  for (const id of nodes.keys()) dfs(id);

  return { nodes, cycles };
}

// ── Queries ────────────────────────────────────────────────────────────────────

/**
 * Get the IDs of reports that a given report depends on.
 *
 * @param graph - The report dependency graph
 * @param reportId - The report to query
 * @returns Array of dependency report IDs (empty if report not found)
 */
export function getReportDependencies(graph: ReportGraph, reportId: string): string[] {
  return graph.nodes.get(reportId)?.dependencies ?? [];
}

/**
 * Get the IDs of reports that depend on a given report.
 *
 * @param graph - The report dependency graph
 * @param reportId - The report to query
 * @returns Array of dependent report IDs (empty if report not found)
 */
export function getReportDependents(graph: ReportGraph, reportId: string): string[] {
  return graph.nodes.get(reportId)?.dependents ?? [];
}

/**
 * Return all detected cycles in the graph.
 *
 * @param graph - The report dependency graph
 * @returns Array of cycles, each an array of report IDs forming a loop
 */
export function detectReportCycles(graph: ReportGraph): string[][] {
  return graph.cycles;
}

/**
 * Compute the topological run order for a single report.
 *
 * Returns the IDs of all reports that must run before the given report
 * (its transitive dependencies), followed by the report itself.
 * Reports involved in cycles are excluded.
 *
 * @param graph - The report dependency graph
 * @param reportId - The report to compute run order for
 * @returns Ordered array of report IDs to execute
 */
export function getRunOrder(graph: ReportGraph, reportId: string): string[] {
  const order: string[] = [];
  const seen  = new Set<string>();
  function visit(id: string): void {
    if (seen.has(id)) return;
    seen.add(id);
    for (const dep of getReportDependencies(graph, id)) visit(dep);
    order.push(id);
  }
  visit(reportId);
  return order;
}

/**
 * Compute the topological run order for all reports in the workspace.
 *
 * Reports involved in cycles are excluded from the result.
 *
 * @param graph - The report dependency graph
 * @returns Ordered array of all report IDs in safe execution order
 */
export function getWorkspaceRunOrder(graph: ReportGraph): string[] {
  const cycleIds = new Set(graph.cycles.flat());
  const order: string[] = [];
  const seen = new Set<string>();
  function visit(id: string): void {
    if (seen.has(id) || cycleIds.has(id)) return;
    seen.add(id);
    for (const dep of getReportDependencies(graph, id)) visit(dep);
    order.push(id);
  }
  for (const id of graph.nodes.keys()) visit(id);
  return order;
}
