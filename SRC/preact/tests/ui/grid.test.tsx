/**
 * Tests for grid.tsx React components — ColumnHeader, ResultGrid, PreviewGrid.
 *
 * Covers: ColumnHeader rendering (label, color bar, conditional buttons, tooltip,
 * sort interaction), ResultGrid empty state, PreviewGrid empty state.
 *
 * Pure utility functions (createBandRowStyler, descriptorsToGridRows, BandHeaderRenderer)
 * are tested separately in grid-bands.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import {
  ColumnHeader,
  ResultGrid,
  PreviewGrid,
  type ColumnHeaderProps,
} from '../../ui/grid';
import { initStore } from '../../core/store';

beforeEach(() => {
  initStore();
});

afterEach(() => {
  cleanup();
});

// ── ColumnHeader ─────────────────────────────────────────────────────────────

function makeHeaderProps(overrides: Partial<ColumnHeaderProps> = {}): ColumnHeaderProps {
  return {
    label: 'Test Column',
    color: null,
    renamed: undefined,
    origCol: null,
    onRename: null,
    onClear: null,
    onContextMenu: null,
    ...overrides,
  };
}

describe('ColumnHeader', () => {
  describe('label rendering', () => {
    it('renders the label text', () => {
      const props = makeHeaderProps({ label: 'OrderId' });
      const { container } = render(<ColumnHeader {...props} />);

      expect(container.textContent).toContain('OrderId');
    });

    it('renders different labels correctly', () => {
      const { container: c1 } = render(
        <ColumnHeader {...makeHeaderProps({ label: 'Company' })} />,
      );
      const { container: c2 } = render(
        <ColumnHeader {...makeHeaderProps({ label: 'Amount' })} />,
      );

      expect(c1.textContent).toContain('Company');
      expect(c2.textContent).toContain('Amount');
    });

    it('renders with empty label without crashing', () => {
      const props = makeHeaderProps({ label: '' });
      const { container } = render(<ColumnHeader {...props} />);
      expect(container).toBeTruthy();
    });
  });

  describe('color bar', () => {
    it('renders a color bar element when color is provided', () => {
      const props = makeHeaderProps({ color: '#4477AA' });
      const { container } = render(<ColumnHeader {...props} />);

      // The color bar is a MUI Box (div) rendered as the first child of the root Box.
      // When color is set, the root has: [colorBar, Typography, ...buttons]
      // When color is null, the root has: [Typography, ...buttons]
      const rootBox = container.querySelector('.MuiBox-root') as HTMLElement;
      const children = Array.from(rootBox.children);
      // First child should be a div (the color bar) when color is provided
      const firstChild = children[0] as HTMLElement;
      expect(firstChild.tagName).toBe('DIV');
      // The color bar div should be a MUI Box (has MuiBox-root class)
      expect(firstChild.classList.contains('MuiBox-root')).toBe(true);
    });

    it('does not render a color bar element when color is null', () => {
      const props = makeHeaderProps({ color: null });
      const { container } = render(<ColumnHeader {...props} />);

      const rootBox = container.querySelector('.MuiBox-root') as HTMLElement;
      const children = Array.from(rootBox.children);
      // First child should be the Typography (p tag), not a color bar div
      const firstChild = children[0] as HTMLElement;
      // Typography renders as <p> by default
      expect(firstChild.tagName).toBe('P');
    });

    it('renders with different colors without crashing', () => {
      const props = makeHeaderProps({ color: '#EE6677' });
      const { container } = render(<ColumnHeader {...props} />);

      // Verify the color bar element exists (same structure check)
      const rootBox = container.querySelector('.MuiBox-root') as HTMLElement;
      const children = Array.from(rootBox.children);
      const firstChild = children[0] as HTMLElement;
      expect(firstChild.tagName).toBe('DIV');
      expect(firstChild.classList.contains('MuiBox-root')).toBe(true);
    });
  });

  describe('conditional buttons', () => {
    it('renders the ⋯ (more) button when onRename is provided', () => {
      const onRename = vi.fn();
      const props = makeHeaderProps({ onRename });
      const { container } = render(<ColumnHeader {...props} />);

      // The ⋯ button is an IconButton with text content '\u22ef'
      const moreBtn = Array.from(container.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('\u22ef'),
      );
      expect(moreBtn).toBeTruthy();
    });

    it('renders the ⋯ button when onContextMenu is provided', () => {
      const onContextMenu = vi.fn();
      const props = makeHeaderProps({ onContextMenu });
      const { container } = render(<ColumnHeader {...props} />);

      const moreBtn = Array.from(container.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('\u22ef'),
      );
      expect(moreBtn).toBeTruthy();
    });

    it('renders the ⋯ button when onMoreClick is provided', () => {
      const onMoreClick = vi.fn();
      const props = makeHeaderProps({ onMoreClick });
      const { container } = render(<ColumnHeader {...props} />);

      const moreBtn = Array.from(container.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('\u22ef'),
      );
      expect(moreBtn).toBeTruthy();
    });

    it('does not render the ⋯ button when no handlers are provided', () => {
      const props = makeHeaderProps({
        onRename: null,
        onContextMenu: null,
        onMoreClick: null,
      });
      const { container } = render(<ColumnHeader {...props} />);

      const moreBtn = Array.from(container.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('\u22ef'),
      );
      expect(moreBtn).toBeFalsy();
    });

    it('renders the × (clear) button when onClear is provided', () => {
      const onClear = vi.fn();
      const props = makeHeaderProps({ onClear });
      const { container } = render(<ColumnHeader {...props} />);

      const clearBtn = Array.from(container.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('\u00d7'),
      );
      expect(clearBtn).toBeTruthy();
    });

    it('does not render the × button when onClear is null', () => {
      const props = makeHeaderProps({ onClear: null });
      const { container } = render(<ColumnHeader {...props} />);

      const clearBtn = Array.from(container.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('\u00d7'),
      );
      expect(clearBtn).toBeFalsy();
    });
  });

  describe('interactions', () => {
    it('calls progressSort when label is clicked', () => {
      const progressSort = vi.fn();
      const props = makeHeaderProps({ progressSort });
      const { container } = render(<ColumnHeader {...props} />);

      // The label is a Typography rendered as a <p> or <span> with cursor:pointer
      // Click on the text content
      const labelEl = Array.from(container.querySelectorAll('*')).find(
        el => el.textContent === 'Test Column' && el.childElementCount === 0,
      );
      expect(labelEl).toBeTruthy();

      fireEvent.click(labelEl!);
      expect(progressSort).toHaveBeenCalledTimes(1);
      expect(progressSort).toHaveBeenCalledWith(false);
    });

    it('calls progressSort with true when label is shift-clicked', () => {
      const progressSort = vi.fn();
      const props = makeHeaderProps({ progressSort });
      const { container } = render(<ColumnHeader {...props} />);

      const labelEl = Array.from(container.querySelectorAll('*')).find(
        el => el.textContent === 'Test Column' && el.childElementCount === 0,
      );

      fireEvent.click(labelEl!, { shiftKey: true });
      expect(progressSort).toHaveBeenCalledWith(true);
    });

    it('calls onClear when × button is clicked', () => {
      const onClear = vi.fn();
      const props = makeHeaderProps({ onClear });
      const { container } = render(<ColumnHeader {...props} />);

      const clearBtn = Array.from(container.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('\u00d7'),
      );
      expect(clearBtn).toBeTruthy();

      fireEvent.click(clearBtn!);
      expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('calls onRename when ⋯ button is clicked (no onMoreClick)', () => {
      const onRename = vi.fn();
      const props = makeHeaderProps({ onRename });
      const { container } = render(<ColumnHeader {...props} />);

      const moreBtn = Array.from(container.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('\u22ef'),
      );
      expect(moreBtn).toBeTruthy();

      fireEvent.click(moreBtn!);
      expect(onRename).toHaveBeenCalledTimes(1);
    });

    it('calls onMoreClick instead of onRename when both are provided', () => {
      const onRename = vi.fn();
      const onMoreClick = vi.fn();
      const props = makeHeaderProps({ onRename, onMoreClick });
      const { container } = render(<ColumnHeader {...props} />);

      const moreBtn = Array.from(container.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('\u22ef'),
      );

      fireEvent.click(moreBtn!);
      expect(onMoreClick).toHaveBeenCalledTimes(1);
      expect(onRename).not.toHaveBeenCalled();
    });

    it('calls onContextMenu on right-click of ⋯ button', () => {
      const onContextMenu = vi.fn();
      const props = makeHeaderProps({ onContextMenu });
      const { container } = render(<ColumnHeader {...props} />);

      const moreBtn = Array.from(container.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('\u22ef'),
      );

      fireEvent.contextMenu(moreBtn!);
      expect(onContextMenu).toHaveBeenCalledTimes(1);
    });
  });

  describe('tooltip', () => {
    it('shows tooltip with original column name when origCol is provided', () => {
      const props = makeHeaderProps({ origCol: 'physical_col' });
      const { container } = render(<ColumnHeader {...props} />);

      // The tooltip is rendered as a title attribute on the Typography element
      const labelEl = Array.from(container.querySelectorAll('*')).find(
        el => el.textContent === 'Test Column' && el.childElementCount === 0,
      );
      expect(labelEl).toBeTruthy();
      expect(labelEl!.getAttribute('title')).toBe('physical_col');
    });

    it('shows "Original: ..." tooltip when renamed is set', () => {
      const props = makeHeaderProps({ origCol: 'physical_col', renamed: 'My Label' });
      const { container } = render(<ColumnHeader {...props} />);

      const labelEl = Array.from(container.querySelectorAll('*')).find(
        el => el.textContent === 'Test Column' && el.childElementCount === 0,
      );
      expect(labelEl!.getAttribute('title')).toBe('Original: physical_col');
    });

    it('does not show tooltip when origCol is null', () => {
      const props = makeHeaderProps({ origCol: null });
      const { container } = render(<ColumnHeader {...props} />);

      const labelEl = Array.from(container.querySelectorAll('*')).find(
        el => el.textContent === 'Test Column' && el.childElementCount === 0,
      );
      // title should be undefined/absent
      expect(labelEl!.getAttribute('title')).toBeFalsy();
    });
  });
});

// ── ResultGrid ───────────────────────────────────────────────────────────────

describe('ResultGrid', () => {
  it('shows empty state when result has no rows and no totals', () => {
    const result = { rows: [], totalsRow: null, cols: ['A', 'B'] };
    const { container } = render(<ResultGrid result={result} />);

    const emptyDiv = container.querySelector('.empty');
    expect(emptyDiv).toBeTruthy();
    expect(container.textContent).toContain('No rows matched your query');
  });

  it('shows empty state with magnifying glass icon', () => {
    const result = { rows: [], totalsRow: null, cols: [] };
    const { container } = render(<ResultGrid result={result} />);

    const icon = container.querySelector('.empty-icon');
    expect(icon).toBeTruthy();
    expect(icon!.textContent).toBe('\u{1F50D}');
  });

  it('shows empty state when bandResult has no parent rows', () => {
    const result = {
      rows: [],
      totalsRow: null,
      cols: [],
      bandResult: {
        parentRows: [],
        parentCols: ['A'],
        bandResults: [],
        bandLabels: {},
      },
    };
    const { container } = render(<ResultGrid result={result} />);

    const emptyDiv = container.querySelector('.empty');
    expect(emptyDiv).toBeTruthy();
    expect(container.textContent).toContain('No rows matched your query');
  });
});

// ── PreviewGrid ──────────────────────────────────────────────────────────────

describe('PreviewGrid', () => {
  it('shows empty state when tableId is empty string', () => {
    const { container } = render(<PreviewGrid tableId="" />);

    const emptyDiv = container.querySelector('.empty');
    expect(emptyDiv).toBeTruthy();
    expect(container.textContent).toContain('Select a table above');
  });

  it('shows empty state with pointing up icon', () => {
    const { container } = render(<PreviewGrid tableId="" />);

    const icon = container.querySelector('.empty-icon');
    expect(icon).toBeTruthy();
    expect(icon!.textContent).toBe('\u{1F446}');
  });

  it('shows empty state when tableId does not exist in store', () => {
    const { container } = render(<PreviewGrid tableId="nonexistent-table" />);

    const emptyDiv = container.querySelector('.empty');
    expect(emptyDiv).toBeTruthy();
    expect(container.textContent).toContain('Select a table above');
  });
});
