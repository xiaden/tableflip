interface LayoutBlock {
  id: string;
  type: string;
  source: { reportId: string | null; resultRef: string | null };
  position: { row: number; col: number; width: number; height: number };
  config: Record<string, unknown>;
}

interface OutputLayout {
  blocks: LayoutBlock[];
}

function _normalizeBlock(block: Partial<LayoutBlock>): LayoutBlock {
  return {
    id:       block.id       || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
    type:     block.type     || 'table',
    source:   Object.assign({ reportId: null, resultRef: null }, block.source   || {}),
    position: Object.assign({ row: 0, col: 0, width: 12, height: 10 }, block.position || {}),
    config:   block.config   || {},
  };
}

export function createOutputLayout(blocks?: Partial<LayoutBlock>[]): OutputLayout {
  return { blocks: Array.isArray(blocks) ? blocks.map(_normalizeBlock) : [] };
}

export function addBlock(layout: OutputLayout, block: Partial<LayoutBlock>): void {
  layout.blocks.push(_normalizeBlock(block));
}

export function removeBlock(layout: OutputLayout, blockId: string): void {
  layout.blocks = layout.blocks.filter((b: LayoutBlock) => b.id !== blockId);
}

export function updateBlock(layout: OutputLayout, blockId: string, updates: Partial<LayoutBlock>): void {
  const idx = layout.blocks.findIndex((b: LayoutBlock) => b.id === blockId);
  if (idx >= 0) layout.blocks[idx] = Object.assign({}, layout.blocks[idx], updates);
}

export function getBlock(layout: OutputLayout, blockId: string): LayoutBlock | null {
  return layout.blocks.find((b: LayoutBlock) => b.id === blockId) || null;
}
