'use strict';

// ── Report Graph ──────────────────────────────────────────────────────────────
// Multi-report workspace dependency tracking.
//
// A report may reference a published output table from another report (as its
// base, a stack, or a lookup right-side).  The graph discovers these
// dependencies and ensures:
//   - Cycles are detected → all reports in a cycle are marked blocked
//   - Blocked upstream reports cascade to downstream dependents
//   - getRunOrder / getWorkspaceRunOrder provide topological ordering
//
// Usage:
//   const graph = buildReportGraph(workspaceState);
//   const order = getWorkspaceRunOrder(graph);   // ['reportA', 'reportB', ...]
//   const cycles = detectReportCycles(graph);     // [] if no cycles

function buildReportGraph(workspaceState) {
  const reports = (workspaceState && workspaceState.reports) || [];
  const nodes   = new Map();

  for (const report of reports) {
    nodes.set(report.id, { report, dependencies: [], dependents: [] });
  }

  // Map publishedOutputId → reportId
  const outputToReport = new Map();
  for (const report of reports) {
    if (report.publish && report.publish.enabled) {
      outputToReport.set(report.id + '_output', report.id);
    }
  }

  // Discover dependencies from pipeline refs
  for (const report of reports) {
    const node     = nodes.get(report.id);
    const pipeline = report.pipeline || {};
    const refs = [
      pipeline.base,
      ...(pipeline.stacks  || []),
      ...(pipeline.lookups || []).map(l => l.rightId),
    ].filter(Boolean);

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

  // Cycle detection via iterative DFS
  const cycles  = [];
  const visited = new Set();
  const inStack = new Set();
  const path    = [];

  function dfs(id) {
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
    if (node) for (const dep of node.dependencies) dfs(dep);
    path.pop();
    inStack.delete(id);
  }

  for (const id of nodes.keys()) dfs(id);

  return { nodes, cycles };
}

function getReportDependencies(graph, reportId) {
  return graph.nodes.get(reportId)?.dependencies || [];
}

function getReportDependents(graph, reportId) {
  return graph.nodes.get(reportId)?.dependents || [];
}

function detectReportCycles(graph) {
  return graph.cycles;
}

// Run order for a single report: dependencies first, then the report itself.
function getRunOrder(graph, reportId) {
  const order = [];
  const seen  = new Set();
  function visit(id) {
    if (seen.has(id)) return;
    seen.add(id);
    for (const dep of getReportDependencies(graph, id)) visit(dep);
    order.push(id);
  }
  visit(reportId);
  return order;
}

// Topological run order for the whole workspace.  Reports in cycles are excluded.
function getWorkspaceRunOrder(graph) {
  const cycleIds = new Set(graph.cycles.flat());
  const order    = [];
  const seen     = new Set();
  function visit(id) {
    if (seen.has(id) || cycleIds.has(id)) return;
    seen.add(id);
    for (const dep of getReportDependencies(graph, id)) visit(dep);
    order.push(id);
  }
  for (const id of graph.nodes.keys()) visit(id);
  return order;
}
