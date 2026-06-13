import { describe, it, expect } from 'vitest';
import {
  createOutputLayout,
  addBlock,
  removeBlock,
  updateBlock,
  getBlock,
} from '../../report/output-layout';
import type { OutputLayout, LayoutBlock } from '../../report/output-layout';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBlock(overrides: Partial<LayoutBlock> = {}): LayoutBlock {
  return {
    id: 'block-1',
    type: 'table',
    source: { reportId: null, resultRef: null },
    position: { row: 0, col: 0, width: 12, height: 10 },
    config: {},
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('output-layout', () => {
  // ── createOutputLayout ───────────────────────────────────────────────────

  describe('createOutputLayout()', () => {
    it('should return empty blocks array when called with no arguments', () => {
      const layout = createOutputLayout();
      expect(layout.blocks).toEqual([]);
    });

    it('should return empty blocks array when called with undefined', () => {
      const layout = createOutputLayout(undefined);
      expect(layout.blocks).toEqual([]);
    });

    it('should normalize partial blocks with auto-generated id, position, etc.', () => {
      const layout = createOutputLayout([{ type: 'chart' }]);
      expect(layout.blocks).toHaveLength(1);
      const block = layout.blocks[0];
      expect(block.type).toBe('chart');
      expect(block.id).toBeTruthy(); // auto-generated
      expect(block.source).toEqual({ reportId: null, resultRef: null });
      expect(block.position).toEqual({ row: 0, col: 0, width: 12, height: 10 });
      expect(block.config).toEqual({});
    });

    it('should preserve explicit id on partial blocks', () => {
      const layout = createOutputLayout([{ id: 'my-id', type: 'text' }]);
      expect(layout.blocks[0].id).toBe('my-id');
    });

    it('should default type to "table" when not specified', () => {
      const layout = createOutputLayout([{ id: 'b1' }]);
      expect(layout.blocks[0].type).toBe('table');
    });

    it('should merge partial source', () => {
      const layout = createOutputLayout([{
        id: 'b1',
        source: { reportId: 'r1', resultRef: null },
      }]);
      expect(layout.blocks[0].source).toEqual({ reportId: 'r1', resultRef: null });
    });

    it('should merge partial position', () => {
      const layout = createOutputLayout([{
        id: 'b1',
        position: { row: 2, col: 3, width: 6, height: 4 },
      }]);
      expect(layout.blocks[0].position).toEqual({ row: 2, col: 3, width: 6, height: 4 });
    });

    it('should not mutate the input array', () => {
      const input: Partial<LayoutBlock>[] = [{ id: 'b1' }];
      const layout = createOutputLayout(input);
      expect(layout.blocks).toHaveLength(1);
      expect(input).toHaveLength(1);
      // The input array itself should not be replaced
      expect(layout.blocks).not.toBe(input);
    });
  });

  // ── addBlock ─────────────────────────────────────────────────────────────

  describe('addBlock()', () => {
    it('should add a block to the layout', () => {
      const layout = createOutputLayout();
      const updated = addBlock(layout, { id: 'b1', type: 'chart' });
      expect(updated.blocks).toHaveLength(1);
      expect(updated.blocks[0].id).toBe('b1');
      expect(updated.blocks[0].type).toBe('chart');
    });

    it('should normalize the added block', () => {
      const layout = createOutputLayout();
      const updated = addBlock(layout, { type: 'text' });
      expect(updated.blocks[0].id).toBeTruthy();
      expect(updated.blocks[0].source).toEqual({ reportId: null, resultRef: null });
      expect(updated.blocks[0].position).toEqual({ row: 0, col: 0, width: 12, height: 10 });
    });

    it('should not mutate the original layout', () => {
      const layout = createOutputLayout([{ id: 'b1' }]);
      const updated = addBlock(layout, { id: 'b2' });
      expect(layout.blocks).toHaveLength(1);
      expect(updated.blocks).toHaveLength(2);
    });

    it('should append the new block at the end', () => {
      const layout = createOutputLayout([{ id: 'b1' }]);
      const updated = addBlock(layout, { id: 'b2' });
      expect(updated.blocks[0].id).toBe('b1');
      expect(updated.blocks[1].id).toBe('b2');
    });
  });

  // ── removeBlock ──────────────────────────────────────────────────────────

  describe('removeBlock()', () => {
    it('should remove a block by id', () => {
      const layout = createOutputLayout([{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }]);
      const updated = removeBlock(layout, 'b2');
      expect(updated.blocks).toHaveLength(2);
      expect(updated.blocks.map(b => b.id)).toEqual(['b1', 'b3']);
    });

    it('should return original layout when block id is not found', () => {
      const layout = createOutputLayout([{ id: 'b1' }]);
      const updated = removeBlock(layout, 'missing');
      expect(updated.blocks).toHaveLength(1);
      expect(updated.blocks[0].id).toBe('b1');
    });

    it('should not mutate the original layout', () => {
      const layout = createOutputLayout([{ id: 'b1' }, { id: 'b2' }]);
      removeBlock(layout, 'b1');
      expect(layout.blocks).toHaveLength(2);
    });

    it('should return empty layout when removing the only block', () => {
      const layout = createOutputLayout([{ id: 'b1' }]);
      const updated = removeBlock(layout, 'b1');
      expect(updated.blocks).toEqual([]);
    });
  });

  // ── updateBlock ──────────────────────────────────────────────────────────

  describe('updateBlock()', () => {
    it('should update block fields by id', () => {
      const layout = createOutputLayout([{ id: 'b1', type: 'table' }]);
      const updated = updateBlock(layout, 'b1', { type: 'chart' });
      expect(updated.blocks[0].type).toBe('chart');
    });

    it('should merge partial updates without losing existing fields', () => {
      const layout = createOutputLayout([{
        id: 'b1',
        type: 'table',
        config: { foo: 'bar' },
      }]);
      const updated = updateBlock(layout, 'b1', { type: 'chart' });
      expect(updated.blocks[0].type).toBe('chart');
      expect(updated.blocks[0].config).toEqual({ foo: 'bar' });
    });

    it('should return original layout when block id is not found', () => {
      const layout = createOutputLayout([{ id: 'b1' }]);
      const updated = updateBlock(layout, 'missing', { type: 'chart' });
      expect(updated).toBe(layout); // same reference
    });

    it('should not mutate the original layout or block', () => {
      const layout = createOutputLayout([{ id: 'b1', type: 'table' }]);
      const originalBlock = layout.blocks[0];
      updateBlock(layout, 'b1', { type: 'chart' });
      expect(layout.blocks[0].type).toBe('table');
      expect(originalBlock.type).toBe('table');
    });

    it('should only update the targeted block', () => {
      const layout = createOutputLayout([{ id: 'b1', type: 'table' }, { id: 'b2', type: 'table' }]);
      const updated = updateBlock(layout, 'b1', { type: 'chart' });
      expect(updated.blocks[0].type).toBe('chart');
      expect(updated.blocks[1].type).toBe('table');
    });
  });

  // ── getBlock ─────────────────────────────────────────────────────────────

  describe('getBlock()', () => {
    it('should return the block matching the given id', () => {
      const layout = createOutputLayout([{ id: 'b1', type: 'table' }, { id: 'b2', type: 'chart' }]);
      const block = getBlock(layout, 'b2');
      expect(block).not.toBeNull();
      expect(block!.id).toBe('b2');
      expect(block!.type).toBe('chart');
    });

    it('should return null when block id is not found', () => {
      const layout = createOutputLayout([{ id: 'b1' }]);
      const block = getBlock(layout, 'missing');
      expect(block).toBeNull();
    });

    it('should return null for empty layout', () => {
      const layout = createOutputLayout();
      const block = getBlock(layout, 'b1');
      expect(block).toBeNull();
    });

    it('should return the actual block object from the layout', () => {
      const layout = createOutputLayout([{ id: 'b1', type: 'table' }]);
      const block = getBlock(layout, 'b1');
      expect(block).toBe(layout.blocks[0]);
    });
  });
});
