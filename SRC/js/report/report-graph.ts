interface ReportNode {
  report: Record<string, unknown>;
  dependencies: string[];
  dependents: string[];
}

interface ReportGraph {
  nodes: Map<string, ReportNode>;
  cycles: string[][];
}

export function buildReportGraph(workspaceState?: Record<string, unknown> | null): ReportGraph {
  const reports = (workspaceState && (workspaceState.reports as Record<string, unknown>[])) || [];
  const nodes   = new Map<string, ReportNode>();

  for (const report of reports) {
    nodes.set(report.id as string, { report, dependencies: [], dependents: [] });
  }

  const outputToReport = new Map<string, string>();
  for (const report of reports) {
    const publish = report.publish as Record<string, unknown> | undefined;
    if (publish && publish.enabled) {
      outputToReport.set((report.id as string) + '_output', report.id as string);
    }
  }

  for (const report of reports) {
    const node     = nodes.get(report.id as string)!;
    const pipeline = (report.pipeline || {}) as Record<string, unknown>;
    const refs = [
      pipeline.base as string | undefined,
      ...((pipeline.stacks as string[])  || []),
      ...((pipeline.lookups as Array<Record<string, unknown>>) || []).map((l: Record<string, unknown>) => l.rightId as string | undefined),
    ].filter(Boolean) as string[];

    for (const ref of refs) {
      const depId = outputToReport.get(ref);
      if (!depId || depId === report.id) continue;
      if (!node.dependencies.includes(depId)) node.dependencies.push(depId);
      const depNode = nodes.get(depId);
      if (depNode && !depNode.dependents.includes(report.id as string)) {
        depNode.dependents.push(report.id as string);
      }
    }
  }

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
    if (node) for (const dep of node.dependencies) dfs(dep);
    path.pop();
    inStack.delete(id);
  }

  for (const id of nodes.keys()) dfs(id);

  return { nodes, cycles };
}

export function getReportDependencies(graph: ReportGraph, reportId: string): string[] {
  return graph.nodes.get(reportId)?.dependencies || [];
}

export function getReportDependents(graph: ReportGraph, reportId: string): string[] {
  return graph.nodes.get(reportId)?.dependents || [];
}

export function detectReportCycles(graph: ReportGraph): string[][] {
  return graph.cycles;
}

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
