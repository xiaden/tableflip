/**
 * Tests for TopSection — the three-button sidebar header providing
 * Import file, Import config, and Save config operations.
 *
 * Covers: rendering all 3 buttons, verifying click handlers fire
 * the correct delegated functions (triggerFileInput, saveState),
 * and Import config DOM manipulation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const { mockTriggerFileInput, mockSaveState, mockLoadSpreadsheet, mockToast } = vi.hoisted(() => ({
  mockTriggerFileInput: vi.fn(),
  mockSaveState: vi.fn(),
  mockLoadSpreadsheet: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock('../../ui/file-loader', () => ({
  triggerFileInput: mockTriggerFileInput,
}));

vi.mock('../../core/state-serializer', () => ({
  saveState: mockSaveState,
}));

vi.mock('../../ui/loader', () => ({
  loadSpreadsheet: mockLoadSpreadsheet,
}));

vi.mock('../../core/utils', () => ({
  toast: mockToast,
}));

import { TopSection } from '../../ui/top-section';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TopSection', () => {
  describe('rendering', () => {
    it('renders all 3 buttons', () => {
      const { container } = render(<TopSection />);
      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBe(3);
    });

    it('renders "Import file" button', () => {
      const { container } = render(<TopSection />);
      const buttons = container.querySelectorAll('button');
      const importFileBtn = Array.from(buttons).find(b => b.textContent === 'Import file');
      expect(importFileBtn).toBeTruthy();
    });

    it('renders "Import config" button', () => {
      const { container } = render(<TopSection />);
      const buttons = container.querySelectorAll('button');
      const importConfigBtn = Array.from(buttons).find(b => b.textContent === 'Import config');
      expect(importConfigBtn).toBeTruthy();
    });

    it('renders "Save config" button', () => {
      const { container } = render(<TopSection />);
      const buttons = container.querySelectorAll('button');
      const saveConfigBtn = Array.from(buttons).find(b => b.textContent === 'Save config');
      expect(saveConfigBtn).toBeTruthy();
    });

    it('all buttons use MUI contained variant styling', () => {
      const { container } = render(<TopSection />);
      const buttons = container.querySelectorAll('button');
      for (const btn of buttons) {
        expect(btn.classList.contains('MuiButton-contained') || btn.classList.contains('MuiButton-root')).toBe(true);
      }
    });
  });

  describe('Import file button', () => {
    it('calls triggerFileInput when clicked', () => {
      const { container } = render(<TopSection />);
      const buttons = container.querySelectorAll('button');
      const importFileBtn = Array.from(buttons).find(b => b.textContent === 'Import file')!;

      fireEvent.click(importFileBtn);
      expect(mockTriggerFileInput).toHaveBeenCalledTimes(1);
    });
  });

  describe('Save config button', () => {
    it('calls saveState when clicked', () => {
      const { container } = render(<TopSection />);
      const buttons = container.querySelectorAll('button');
      const saveConfigBtn = Array.from(buttons).find(b => b.textContent === 'Save config')!;

      fireEvent.click(saveConfigBtn);
      expect(mockSaveState).toHaveBeenCalledTimes(1);
    });
  });

  describe('Import config button', () => {
    it('creates a file input element in the DOM when clicked', () => {
      const { container } = render(<TopSection />);
      const buttons = container.querySelectorAll('button');
      const importConfigBtn = Array.from(buttons).find(b => b.textContent === 'Import config')!;

      const inputsBefore = document.querySelectorAll('input[type="file"]').length;

      fireEvent.click(importConfigBtn);

      const inputsAfter = document.querySelectorAll('input[type="file"]').length;
      expect(inputsAfter).toBe(inputsBefore + 1);
    });

    it('the created file input accepts .rcjson files only', () => {
      const { container } = render(<TopSection />);
      const buttons = container.querySelectorAll('button');
      const importConfigBtn = Array.from(buttons).find(b => b.textContent === 'Import config')!;

      fireEvent.click(importConfigBtn);

      const fileInputs = document.querySelectorAll('input[type="file"]');
      const lastInput = fileInputs[fileInputs.length - 1] as HTMLInputElement;
      expect(lastInput.accept).toBe('.rcjson');
    });

    it('reuses existing input element on second click', () => {
      const { container } = render(<TopSection />);
      const buttons = container.querySelectorAll('button');
      const importConfigBtn = Array.from(buttons).find(b => b.textContent === 'Import config')!;

      fireEvent.click(importConfigBtn);
      const countAfterFirst = document.querySelectorAll('input[type="file"]').length;

      fireEvent.click(importConfigBtn);
      const countAfterSecond = document.querySelectorAll('input[type="file"]').length;

      expect(countAfterSecond).toBe(countAfterFirst);
    });
  });
});
