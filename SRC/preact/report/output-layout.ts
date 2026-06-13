/**
 * Output layout management.
 *
 * Manages the grid-based layout of output blocks on the report canvas.
 * Each block has a position (row, col, width, height), a type, a source
 * reference, and freeform config.
 *
 * Ported from SRC/js/report/output-layout.ts — zero imports from SRC/js/.
 * All functions are pure: they accept explicit parameters and return new
 * objects rather than mutating inputs.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * A single positioned block on the output layout canvas.
 * @property id - Unique block identifier (UUID)
 * @property type - Block type (e.g. 'table', 'chart', 'text')
 * @property source - Data source reference (reportId + resultRef)
 * @property position - Grid position and dimensions
 * @property config - Freeform configuration object
 */
export interface LayoutBlock {
  id: string;
  type: string;
  source: { reportId: string | null; resultRef: string | null };
  position: { row: number; col: number; width: number; height: number };
  config: Record<string, unknown>;
}

/**
 * A complete output layout containing an ordered list of blocks.
 * @property blocks - Array of positioned layout blocks
 */
export interface OutputLayout {
  blocks: LayoutBlock[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Generate a unique block ID.
 * Uses crypto.randomUUID when available, falls back to timestamp + random.
 */
function _generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return String(Date.now()) + Math.random().toString(36).slice(2);
}

/**
 * Normalize a partial block into a fully-populated {@link LayoutBlock}.
 * Fills in defaults for missing fields:
 * - id: random UUID
 * - type: 'table'
 * - source: { reportId: null, resultRef: null }
 * - position: { row: 0, col: 0, width: 12, height: 10 }
 * - config: {}
 * @param block - Partial block to normalize
 * @returns A complete LayoutBlock
 */
function _normalizeBlock(block: Partial<LayoutBlock>): LayoutBlock {
  return {
    id:       block.id       || _generateId(),
    type:     block.type     || 'table',
    source:   Object.assign({ reportId: null, resultRef: null }, block.source   || {}),
    position: Object.assign({ row: 0, col: 0, width: 12, height: 10 }, block.position || {}),
    config:   block.config   || {},
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Create a new {@link OutputLayout}, optionally normalizing an initial set of blocks.
 * Pure — does not mutate the input array.
 * @param blocks - Optional array of partial blocks to populate the layout
 * @returns A new OutputLayout
 */
export function createOutputLayout(blocks?: Partial<LayoutBlock>[]): OutputLayout {
  return { blocks: Array.isArray(blocks) ? blocks.map(_normalizeBlock) : [] };
}

/**
 * Add a block to a layout, returning a new layout.
 * Pure — does not mutate the input layout.
 * @param layout - The existing layout
 * @param block - Partial block to add (will be normalized)
 * @returns A new OutputLayout with the block appended
 */
export function addBlock(layout: OutputLayout, block: Partial<LayoutBlock>): OutputLayout {
  return { blocks: [...layout.blocks, _normalizeBlock(block)] };
}

/**
 * Remove a block by ID from a layout, returning a new layout.
 * Pure — does not mutate the input layout.
 * @param layout - The existing layout
 * @param blockId - ID of the block to remove
 * @returns A new OutputLayout without the specified block
 */
export function removeBlock(layout: OutputLayout, blockId: string): OutputLayout {
  return { blocks: layout.blocks.filter((b: LayoutBlock) => b.id !== blockId) };
}

/**
 * Update a block by ID with partial field overrides, returning a new layout.
 * Pure — does not mutate the input layout or block.
 * If the blockId is not found, the layout is returned unchanged.
 * @param layout - The existing layout
 * @param blockId - ID of the block to update
 * @param updates - Partial block fields to merge
 * @returns A new OutputLayout with the updated block
 */
export function updateBlock(layout: OutputLayout, blockId: string, updates: Partial<LayoutBlock>): OutputLayout {
  const idx = layout.blocks.findIndex((b: LayoutBlock) => b.id === blockId);
  if (idx < 0) return layout;
  const updated = Object.assign({}, layout.blocks[idx], updates);
  const blocks = layout.blocks.slice();
  blocks[idx] = updated;
  return { blocks };
}

/**
 * Look up a block by ID in a layout.
 * Pure — returns the block or null without side effects.
 * @param layout - The layout to search
 * @param blockId - ID of the block to find
 * @returns The matching LayoutBlock, or null if not found
 */
export function getBlock(layout: OutputLayout, blockId: string): LayoutBlock | null {
  return layout.blocks.find((b: LayoutBlock) => b.id === blockId) || null;
}
