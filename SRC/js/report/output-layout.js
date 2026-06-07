// ── Output Layout ─────────────────────────────────────────────────────────────
// Foundation for future multi-block report pages.  Not yet consumed by any
// rendering layer — defines the spec shape so the architecture is stable.
//
// Block types:
//   table         — full result table (default)
//   subtotalTable — table with subtotal/grand-total rows
//   summaryBox    — key→value pairs
//   textBox       — static text / markdown
//   kpiBox        — single metric highlight
//
// Block shape:
//   {
//     id:       string,
//     type:     'table'|'subtotalTable'|'summaryBox'|'textBox'|'kpiBox',
//     source:   { reportId: string, resultRef: string|null },
//     position: { row: number, col: number, width: number, height: number },
//     config:   {},   // block-type-specific config
//   }

function _normalizeBlock(block) {
  return {
    id:       block.id       || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
    type:     block.type     || 'table',
    source:   Object.assign({ reportId: null, resultRef: null }, block.source   || {}),
    position: Object.assign({ row: 0, col: 0, width: 12, height: 10 }, block.position || {}),
    config:   block.config   || {},
  };
}

export function createOutputLayout(blocks) {
  return { blocks: Array.isArray(blocks) ? blocks.map(_normalizeBlock) : [] };
}

export function addBlock(layout, block) {
  layout.blocks.push(_normalizeBlock(block));
}

export function removeBlock(layout, blockId) {
  layout.blocks = layout.blocks.filter(b => b.id !== blockId);
}

export function updateBlock(layout, blockId, updates) {
  const idx = layout.blocks.findIndex(b => b.id === blockId);
  if (idx >= 0) layout.blocks[idx] = Object.assign({}, layout.blocks[idx], updates);
}

export function getBlock(layout, blockId) {
  return layout.blocks.find(b => b.id === blockId) || null;
}
