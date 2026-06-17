/**
 * Tests for the RenameModal component — a dialog for renaming columns and
 * calculated column aliases.
 *
 * Covers: rendering with correct title, input field behavior, submit/cancel
 * buttons, Enter key submission, onDone callback, and calculated column path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { RenameModal, type RenameTarget } from '../../ui/components/rename-modal';
import { initStore, getStore } from '../../core/store';

// Mock setColLabel to avoid store side effects and verify calls
vi.mock('../../core/utils', async () => {
  const actual = await vi.importActual('../../core/utils');
  return {
    ...actual,
    setColLabel: vi.fn(),
  };
});

// Mock renameCalcAlias to avoid store side effects and verify calls
vi.mock('../../core/alias-rename', () => ({
  renameCalcAlias: vi.fn(),
}));

// Mock buildColSourceMap (used by resolveRenameTarget, not directly by RenameModal)
vi.mock('../../catalog/column-catalog', () => ({
  buildColSourceMap: vi.fn().mockReturnValue(new Map()),
}));

import { setColLabel } from '../../core/utils';
import { renameCalcAlias } from '../../core/alias-rename';

beforeEach(() => {
  initStore();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('RenameModal', () => {
  describe('rendering', () => {
    it('renders with title "Rename column"', () => {
      const target: RenameTarget = { alias: 'col1', tid: 'tbl1', col: 'col1' };
      render(
        <RenameModal target={target} onClose={vi.fn()} />,
      );

      expect(screen.getByText('Rename column')).toBeTruthy();
    });

    it('renders a text input field', () => {
      const target: RenameTarget = { alias: 'col1', tid: 'tbl1', col: 'col1' };
      render(
        <RenameModal target={target} onClose={vi.fn()} />,
      );

      const input = screen.getByRole('textbox');
      expect(input).toBeTruthy();
    });

    it('renders Cancel and Rename buttons', () => {
      const target: RenameTarget = { alias: 'col1', tid: 'tbl1', col: 'col1' };
      render(
        <RenameModal target={target} onClose={vi.fn()} />,
      );

      expect(screen.getByText('Cancel')).toBeTruthy();
      expect(screen.getByText('Rename')).toBeTruthy();
    });

    it('input shows the alias as default value when no label is set', () => {
      const target: RenameTarget = { alias: 'MyColumn', tid: 'tbl1', col: 'MyColumn' };
      render(
        <RenameModal target={target} onClose={vi.fn()} />,
      );

      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe('MyColumn');
    });

    it('input shows existing column label when set in store', () => {
      // Set up a column label in the store
      act(() => {
        getStore().update(draft => {
          draft.columnLabels['tbl1'] = { 'phys_col': 'Custom Label' };
        });
      });

      const target: RenameTarget = { alias: 'phys_col', tid: 'tbl1', col: 'phys_col' };
      render(
        <RenameModal target={target} onClose={vi.fn()} />,
      );

      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe('Custom Label');
    });
  });

  describe('input field', () => {
    it('allows editing the input value', () => {
      const target: RenameTarget = { alias: 'col1', tid: 'tbl1', col: 'col1' };
      render(
        <RenameModal target={target} onClose={vi.fn()} />,
      );

      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe('col1');

      fireEvent.change(input, { target: { value: 'New Name' } });
      expect(input.value).toBe('New Name');
    });

    it('input has the label "Current name"', () => {
      const target: RenameTarget = { alias: 'col1', tid: 'tbl1', col: 'col1' };
      render(
        <RenameModal target={target} onClose={vi.fn()} />,
      );

      // MUI TextField renders both a <label> and a <span> with the label text.
      // Use getAllByText to handle multiple matches.
      const elements = screen.getAllByText('Current name');
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('cancel behavior', () => {
    it('calls onClose when Cancel button is clicked', () => {
      const onClose = vi.fn();
      const target: RenameTarget = { alias: 'col1', tid: 'tbl1', col: 'col1' };
      render(
        <RenameModal target={target} onClose={onClose} />,
      );

      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call setColLabel when Cancel is clicked', () => {
      const target: RenameTarget = { alias: 'col1', tid: 'tbl1', col: 'col1' };
      render(
        <RenameModal target={target} onClose={vi.fn()} />,
      );

      fireEvent.click(screen.getByText('Cancel'));
      expect(setColLabel).not.toHaveBeenCalled();
    });

    it('does not call onDone when Cancel is clicked', () => {
      const onDone = vi.fn();
      const target: RenameTarget = { alias: 'col1', tid: 'tbl1', col: 'col1' };
      render(
        <RenameModal target={target} onClose={vi.fn()} onDone={onDone} />,
      );

      fireEvent.click(screen.getByText('Cancel'));
      expect(onDone).not.toHaveBeenCalled();
    });
  });

  describe('submit behavior', () => {
    it('calls setColLabel with tid, col, and new name on Rename click', () => {
      const target: RenameTarget = { alias: 'col1', tid: 'tbl1', col: 'phys_col' };
      render(
        <RenameModal target={target} onClose={vi.fn()} />,
      );

      // Change the input value
      const input = screen.getByRole('textbox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'New Label' } });

      // Click Rename
      fireEvent.click(screen.getByText('Rename'));

      expect(setColLabel).toHaveBeenCalledTimes(1);
      expect(setColLabel).toHaveBeenCalledWith('tbl1', 'phys_col', 'New Label');
    });

    it('calls onClose after successful rename', () => {
      const onClose = vi.fn();
      const target: RenameTarget = { alias: 'col1', tid: 'tbl1', col: 'col1' };
      render(
        <RenameModal target={target} onClose={onClose} />,
      );

      fireEvent.click(screen.getByText('Rename'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onDone after successful rename when provided', () => {
      const onDone = vi.fn();
      const target: RenameTarget = { alias: 'col1', tid: 'tbl1', col: 'col1' };
      render(
        <RenameModal target={target} onClose={vi.fn()} onDone={onDone} />,
      );

      fireEvent.click(screen.getByText('Rename'));
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('does not throw when onDone is not provided and Rename is clicked', () => {
      const target: RenameTarget = { alias: 'col1', tid: 'tbl1', col: 'col1' };
      render(
        <RenameModal target={target} onClose={vi.fn()} />,
      );

      expect(() => {
        fireEvent.click(screen.getByText('Rename'));
      }).not.toThrow();
    });
  });

  describe('Enter key submission', () => {
    it('triggers rename when Enter is pressed in the input', () => {
      const onClose = vi.fn();
      const target: RenameTarget = { alias: 'col1', tid: 'tbl1', col: 'phys_col' };
      render(
        <RenameModal target={target} onClose={onClose} />,
      );

      const input = screen.getByRole('textbox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'Enter Name' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(setColLabel).toHaveBeenCalledWith('tbl1', 'phys_col', 'Enter Name');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not trigger rename on non-Enter keys', () => {
      const onClose = vi.fn();
      const target: RenameTarget = { alias: 'col1', tid: 'tbl1', col: 'col1' };
      render(
        <RenameModal target={target} onClose={onClose} />,
      );

      const input = screen.getByRole('textbox') as HTMLInputElement;
      // Use a regular character key that doesn't trigger any special behavior
      fireEvent.keyDown(input, { key: 'a' });

      expect(setColLabel).not.toHaveBeenCalled();
    });
  });

  describe('calculated column path', () => {
    it('calls renameCalcAlias for calculated columns', () => {
      // Set up calcStages in the store
      act(() => {
        getStore().update(draft => {
          draft.calcStages = [{ alias: 'Calc1', mode: 'math' }];
        });
      });

      const target: RenameTarget = { alias: 'Calc1', calcIdx: 0 };
      const onClose = vi.fn();
      render(
        <RenameModal target={target} onClose={onClose} />,
      );

      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe('Calc1');

      fireEvent.change(input, { target: { value: 'RenamedCalc' } });
      fireEvent.click(screen.getByText('Rename'));

      expect(renameCalcAlias).toHaveBeenCalledTimes(1);
      expect(renameCalcAlias).toHaveBeenCalledWith(0, 'RenamedCalc');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call renameCalcAlias when name is unchanged', () => {
      act(() => {
        getStore().update(draft => {
          draft.calcStages = [{ alias: 'Calc1', mode: 'math' }];
        });
      });

      const target: RenameTarget = { alias: 'Calc1', calcIdx: 0 };
      render(
        <RenameModal target={target} onClose={vi.fn()} />,
      );

      // Don't change the input — just click Rename
      fireEvent.click(screen.getByText('Rename'));

      // renameCalcAlias should NOT be called because the name hasn't changed
      expect(renameCalcAlias).not.toHaveBeenCalled();
    });
  });
});

// Need to import act for store mutations
import { act } from 'react';
