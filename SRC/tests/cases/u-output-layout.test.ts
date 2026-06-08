import { describe, it, expect } from 'vitest';
import {
  createOutputLayout,
  addBlock,
  removeBlock,
  updateBlock,
  getBlock,
} from '../../js/report/output-layout.js';

describe('Output Layout', () => {
  describe('createOutputLayout', () => {
    it('should create empty layout with no arguments', () => {
      const layout = createOutputLayout();
      expect(layout.blocks).toEqual([]);
    });

    it('should create empty layout with undefined blocks', () => {
      const layout = createOutputLayout(undefined);
      expect(layout.blocks).toEqual([]);
    });

    it('should create layout with provided blocks', () => {
      const layout = createOutputLayout([
        { id: 'b1', type: 'table' },
        { id: 'b2', type: 'chart' },
      ]);
      expect(layout.blocks.length).toBe(2);
      expect(layout.blocks[0].id).toBe('b1');
      expect(layout.blocks[0].type).toBe('table');
      expect(layout.blocks[1].id).toBe('b2');
      expect(layout.blocks[1].type).toBe('chart');
    });

    it('should normalize blocks with defaults', () => {
      const layout = createOutputLayout([{ id: 'b1' }]);
      const block = layout.blocks[0];
      expect(block.type).toBe('table');
      expect(block.source).toEqual({ reportId: null, resultRef: null });
      expect(block.position).toEqual({ row: 0, col: 0, width: 12, height: 10 });
      expect(block.config).toEqual({});
    });

    it('should preserve provided block properties', () => {
      const layout = createOutputLayout([
        {
          id: 'b1',
          type: 'chart',
          source: { reportId: 'r1', resultRef: 'ref1' },
          position: { row: 5, col: 3, width: 6, height: 8 },
          config: { color: 'blue' },
        },
      ]);
      const block = layout.blocks[0];
      expect(block.type).toBe('chart');
      expect(block.source).toEqual({ reportId: 'r1', resultRef: 'ref1' });
      expect(block.position).toEqual({ row: 5, col: 3, width: 6, height: 8 });
      expect(block.config).toEqual({ color: 'blue' });
    });

    it('should merge partial source/position with defaults', () => {
      const layout = createOutputLayout([
        { id: 'b1', source: { reportId: 'r1' } as any, position: { row: 2 } as any },
      ]);
      const block = layout.blocks[0];
      expect(block.source.reportId).toBe('r1');
      expect(block.source.resultRef).toBeNull();
      expect(block.position.row).toBe(2);
      expect(block.position.col).toBe(0);
      expect(block.position.width).toBe(12);
      expect(block.position.height).toBe(10);
    });
  });

  describe('addBlock', () => {
    it('should add a block to the layout', () => {
      const layout = createOutputLayout();
      addBlock(layout, { id: 'b1', type: 'table' });
      expect(layout.blocks.length).toBe(1);
      expect(layout.blocks[0].id).toBe('b1');
    });

    it('should add multiple blocks', () => {
      const layout = createOutputLayout();
      addBlock(layout, { id: 'b1' });
      addBlock(layout, { id: 'b2' });
      addBlock(layout, { id: 'b3' });
      expect(layout.blocks.length).toBe(3);
    });

    it('should normalize added blocks', () => {
      const layout = createOutputLayout();
      addBlock(layout, { id: 'b1' });
      const block = layout.blocks[0];
      expect(block.type).toBe('table');
      expect(block.source).toEqual({ reportId: null, resultRef: null });
      expect(block.position).toEqual({ row: 0, col: 0, width: 12, height: 10 });
      expect(block.config).toEqual({});
    });
  });

  describe('removeBlock', () => {
    it('should remove a block by id', () => {
      const layout = createOutputLayout([{ id: 'b1' }, { id: 'b2' }]);
      removeBlock(layout, 'b1');
      expect(layout.blocks.length).toBe(1);
      expect(layout.blocks[0].id).toBe('b2');
    });

    it('should do nothing if block id not found', () => {
      const layout = createOutputLayout([{ id: 'b1' }]);
      removeBlock(layout, 'nonexistent');
      expect(layout.blocks.length).toBe(1);
    });

    it('should handle removing from empty layout', () => {
      const layout = createOutputLayout();
      removeBlock(layout, 'b1');
      expect(layout.blocks.length).toBe(0);
    });

    it('should remove only the matching block', () => {
      const layout = createOutputLayout([
        { id: 'b1' }, { id: 'b2' }, { id: 'b3' },
      ]);
      removeBlock(layout, 'b2');
      expect(layout.blocks.length).toBe(2);
      expect(layout.blocks.map(b => b.id)).toEqual(['b1', 'b3']);
    });
  });

  describe('updateBlock', () => {
    it('should update an existing block', () => {
      const layout = createOutputLayout([{ id: 'b1', type: 'table' }]);
      updateBlock(layout, 'b1', { type: 'chart' });
      expect(layout.blocks[0].type).toBe('chart');
      expect(layout.blocks[0].id).toBe('b1');
    });

    it('should merge updates with existing properties', () => {
      const layout = createOutputLayout([
        { id: 'b1', type: 'table', config: { color: 'red' } },
      ]);
      updateBlock(layout, 'b1', { config: { size: 'large' } });
      expect(layout.blocks[0].config).toEqual({ size: 'large' });
    });

    it('should update position partially', () => {
      const layout = createOutputLayout([
        { id: 'b1', position: { row: 0, col: 0, width: 12, height: 10 } },
      ]);
      updateBlock(layout, 'b1', { position: { row: 5, col: 3, width: 6, height: 8 } } as any);
      expect(layout.blocks[0].position.row).toBe(5);
      expect(layout.blocks[0].position.col).toBe(3);
    });

    it('should do nothing if block id not found', () => {
      const layout = createOutputLayout([{ id: 'b1' }]);
      updateBlock(layout, 'nonexistent', { type: 'chart' });
      expect(layout.blocks.length).toBe(1);
      expect(layout.blocks[0].type).toBe('table');
    });
  });

  describe('getBlock', () => {
    it('should return block by id', () => {
      const layout = createOutputLayout([{ id: 'b1', type: 'table' }]);
      const block = getBlock(layout, 'b1');
      expect(block).not.toBeNull();
      expect(block!.id).toBe('b1');
      expect(block!.type).toBe('table');
    });

    it('should return null for unknown block id', () => {
      const layout = createOutputLayout([{ id: 'b1' }]);
      expect(getBlock(layout, 'nonexistent')).toBeNull();
    });

    it('should return null for empty layout', () => {
      const layout = createOutputLayout();
      expect(getBlock(layout, 'b1')).toBeNull();
    });

    it('should return correct block from multiple blocks', () => {
      const layout = createOutputLayout([
        { id: 'b1', type: 'table' },
        { id: 'b2', type: 'chart' },
        { id: 'b3', type: 'table' },
      ]);
      const block = getBlock(layout, 'b2');
      expect(block).not.toBeNull();
      expect(block!.type).toBe('chart');
    });
  });
});
