/**
 * Tests for JoinOptionsPopup — popup for configuring lookup behavior.
 *
 * Covers: rendering sections, radio group reflection, store mutations on change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { initStore, getStore } from '../../core/store';

const { mockInvalidateValidation } = vi.hoisted(() => ({
  mockInvalidateValidation: vi.fn(),
}));

vi.mock('../../report/validation', () => ({
  invalidateValidation: mockInvalidateValidation,
}));

import { JoinOptionsPopup } from '../../ui/join-options-popup';
import type { LookupSpec } from '../../types';

let anchorEl: HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  anchorEl = document.createElement('button');
  document.body.appendChild(anchorEl);
  initStore();
});

afterEach(() => {
  cleanup();
  document.body.removeChild(anchorEl);
  vi.restoreAllMocks();
});

function seedLookup(overrides: Partial<LookupSpec> = {}): LookupSpec {
  const lookup: LookupSpec = {
    rightId: 'customers',
    keyPairs: [{ left: 'CustId', right: 'Id' }],
    cols: ['CompanyName'],
    required: false,
    enabled: true,
    duplicatePolicy: { mode: 'first' },
    ...overrides,
  };
  getStore().update(draft => {
    draft.lookups.push(lookup);
  });
  return lookup;
}

describe('JoinOptionsPopup', () => {
  describe('rendering', () => {
    it('renders "If no match" section', () => {
      const lookup = seedLookup();
      render(
        <JoinOptionsPopup
          open={true}
          anchorEl={anchorEl}
          onClose={vi.fn()}
          lookup={lookup}
          lookupIndex={0}
        />,
      );
      expect(screen.getByText('If no match')).toBeTruthy();
    });

    it('renders "Duplicate keys" section', () => {
      const lookup = seedLookup();
      render(
        <JoinOptionsPopup
          open={true}
          anchorEl={anchorEl}
          onClose={vi.fn()}
          lookup={lookup}
          lookupIndex={0}
        />,
      );
      expect(screen.getByText('Duplicate keys')).toBeTruthy();
    });

    it('renders "Keep row" and "Only matching rows" labels', () => {
      const lookup = seedLookup();
      render(
        <JoinOptionsPopup
          open={true}
          anchorEl={anchorEl}
          onClose={vi.fn()}
          lookup={lookup}
          lookupIndex={0}
        />,
      );
      expect(screen.getByText('Keep row')).toBeTruthy();
      expect(screen.getByText('Only matching rows')).toBeTruthy();
    });

    it('renders "Keep first match" and "Combine values" labels', () => {
      const lookup = seedLookup();
      render(
        <JoinOptionsPopup
          open={true}
          anchorEl={anchorEl}
          onClose={vi.fn()}
          lookup={lookup}
          lookupIndex={0}
        />,
      );
      expect(screen.getByText('Keep first match')).toBeTruthy();
      expect(screen.getByText('Combine values')).toBeTruthy();
    });
  });

  describe('radio group reflects lookup state', () => {
    it('selects "Keep row" when required=false', () => {
      const lookup = seedLookup({ required: false });
      render(
        <JoinOptionsPopup
          open={true}
          anchorEl={anchorEl}
          onClose={vi.fn()}
          lookup={lookup}
          lookupIndex={0}
        />,
      );
      // The "left" radio (Keep row) should be checked
      const keepRowLabel = screen.getByText('Keep row');
      const radioInput = keepRowLabel.closest('label')?.querySelector('input[type="radio"]');
      expect(radioInput).toBeTruthy();
      expect((radioInput as HTMLInputElement).checked).toBe(true);
    });

    it('selects "Only matching rows" when required=true', () => {
      const lookup = seedLookup({ required: true });
      render(
        <JoinOptionsPopup
          open={true}
          anchorEl={anchorEl}
          onClose={vi.fn()}
          lookup={lookup}
          lookupIndex={0}
        />,
      );
      const innerLabel = screen.getByText('Only matching rows');
      const radioInput = innerLabel.closest('label')?.querySelector('input[type="radio"]');
      expect(radioInput).toBeTruthy();
      expect((radioInput as HTMLInputElement).checked).toBe(true);
    });
  });

  describe('store mutations', () => {
    it('changing match to inner sets required=true', () => {
      const lookup = seedLookup({ required: false });
      render(
        <JoinOptionsPopup
          open={true}
          anchorEl={anchorEl}
          onClose={vi.fn()}
          lookup={lookup}
          lookupIndex={0}
        />,
      );

      const innerLabel = screen.getByText('Only matching rows');
      const radioInput = innerLabel.closest('label')?.querySelector('input[type="radio"]') as HTMLInputElement;

      act(() => {
        fireEvent.click(radioInput);
      });

      const state = getStore().getState();
      expect(state.lookups[0].required).toBe(true);
      expect(mockInvalidateValidation).toHaveBeenCalled();
    });

    it('changing match to left sets required=false', () => {
      const lookup = seedLookup({ required: true });
      render(
        <JoinOptionsPopup
          open={true}
          anchorEl={anchorEl}
          onClose={vi.fn()}
          lookup={lookup}
          lookupIndex={0}
        />,
      );

      const keepRowLabel = screen.getByText('Keep row');
      const radioInput = keepRowLabel.closest('label')?.querySelector('input[type="radio"]') as HTMLInputElement;

      act(() => {
        fireEvent.click(radioInput);
      });

      const state = getStore().getState();
      expect(state.lookups[0].required).toBe(false);
    });

    it('changing duplicate to combine sets duplicatePolicy.mode="combine"', () => {
      const lookup = seedLookup({ duplicatePolicy: { mode: 'first' } });
      render(
        <JoinOptionsPopup
          open={true}
          anchorEl={anchorEl}
          onClose={vi.fn()}
          lookup={lookup}
          lookupIndex={0}
        />,
      );

      const combineLabel = screen.getByText('Combine values');
      const radioInput = combineLabel.closest('label')?.querySelector('input[type="radio"]') as HTMLInputElement;

      act(() => {
        fireEvent.click(radioInput);
      });

      const state = getStore().getState();
      expect(state.lookups[0].duplicatePolicy.mode).toBe('combine');
      expect(state.lookups[0].duplicatePolicy.combine).toBeTruthy();
      expect(state.lookups[0].duplicatePolicy.combine!.separator).toBe(', ');
    });

    it('changing duplicate to first sets duplicatePolicy.mode="first"', () => {
      const lookup = seedLookup({
        duplicatePolicy: { mode: 'combine', combine: { separator: ', ', unique: false, includeBlank: false, sort: false } },
      });
      render(
        <JoinOptionsPopup
          open={true}
          anchorEl={anchorEl}
          onClose={vi.fn()}
          lookup={lookup}
          lookupIndex={0}
        />,
      );

      const firstLabel = screen.getByText('Keep first match');
      const radioInput = firstLabel.closest('label')?.querySelector('input[type="radio"]') as HTMLInputElement;

      act(() => {
        fireEvent.click(radioInput);
      });

      const state = getStore().getState();
      expect(state.lookups[0].duplicatePolicy.mode).toBe('first');
    });
  });
});
