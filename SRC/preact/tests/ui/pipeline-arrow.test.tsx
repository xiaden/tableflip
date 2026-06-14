import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { PipelineArrow } from '../../ui/sections/pipeline-arrow';
import type { PreviewResult } from '../../report/preview-builder';
import { _previewOpen } from '../../query/layout-selection';

function makeResult(overrides: Partial<PreviewResult> = {}): PreviewResult {
  return {
    headers: ['Col A', 'Col B'],
    rows: [
      { 'Col A': 'a1', 'Col B': 'b1' },
      { 'Col A': 'a2', 'Col B': 'b2' },
    ],
    error: null,
    ...overrides,
  };
}

describe('PipelineArrow', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    _previewOpen.clear();
  });

  afterEach(() => {
    document.body.removeChild(container);
    _previewOpen.clear();
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  describe('rendering', () => {
    it('renders the toggle button', () => {
      act(() => {
        render(<PipelineArrow id="base" />, container);
      });

      const btn = container.querySelector('.pl-preview-btn');
      expect(btn).toBeTruthy();
      expect(btn!.textContent).toContain('Preview');
    });

    it('renders placeholder when no result prop is provided', () => {
      act(() => {
        render(<PipelineArrow id="base" />, container);
      });

      // Open the preview
      const btn = container.querySelector('.pl-preview-btn')!;
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const preview = container.querySelector('.pl-mini-preview');
      expect(preview).toBeTruthy();
      expect(preview!.textContent).toContain('Preview not available yet');
    });

    it('renders placeholder when result is null', () => {
      act(() => {
        render(<PipelineArrow id="base" result={null} />, container);
      });

      const btn = container.querySelector('.pl-preview-btn')!;
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(container.textContent).toContain('Preview not available yet');
    });
  });

  // ── Preview table ────────────────────────────────────────────────────────

  describe('preview table', () => {
    it('renders a table when result has rows', () => {
      act(() => {
        render(<PipelineArrow id="base" result={makeResult()} />, container);
      });

      // Open the preview
      const btn = container.querySelector('.pl-preview-btn')!;
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const table = container.querySelector('table');
      expect(table).toBeTruthy();

      // Headers
      const ths = table!.querySelectorAll('th');
      expect(ths.length).toBe(2);
      expect(ths[0].textContent).toBe('Col A');
      expect(ths[1].textContent).toBe('Col B');

      // Rows
      const tds = table!.querySelectorAll('td');
      expect(tds.length).toBe(4); // 2 rows × 2 cols
    });

    it('renders cell values as strings', () => {
      act(() => {
        render(<PipelineArrow id="base" result={makeResult()} />, container);
      });

      const btn = container.querySelector('.pl-preview-btn')!;
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const tds = container.querySelectorAll('td');
      expect(tds[0].textContent).toBe('a1');
      expect(tds[1].textContent).toBe('b1');
    });

    it('renders empty string for null cell values', () => {
      const result = makeResult({
        rows: [{ 'Col A': null, 'Col B': 'b1' }],
      });

      act(() => {
        render(<PipelineArrow id="base" result={result} />, container);
      });

      const btn = container.querySelector('.pl-preview-btn')!;
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const tds = container.querySelectorAll('td');
      expect(tds[0].textContent).toBe('');
      expect(tds[1].textContent).toBe('b1');
    });
  });

  // ── Error handling ───────────────────────────────────────────────────────

  describe('error handling', () => {
    it('renders error message in red when result has error', () => {
      const result = makeResult({ error: 'Something went wrong' });

      act(() => {
        render(<PipelineArrow id="base" result={result} />, container);
      });

      const btn = container.querySelector('.pl-preview-btn')!;
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(container.textContent).toContain('Something went wrong');
      const errorDiv = container.querySelector('.pl-mini-preview')!.querySelector('div');
      expect(errorDiv).toBeTruthy();
      expect(errorDiv!.getAttribute('style')).toContain('d32f2f');
    });

    it('renders "No rows" when result has empty rows array', () => {
      const result = makeResult({ rows: [] });

      act(() => {
        render(<PipelineArrow id="base" result={result} />, container);
      });

      const btn = container.querySelector('.pl-preview-btn')!;
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(container.textContent).toContain('No rows');
    });
  });

  // ── Toggle behavior ──────────────────────────────────────────────────────

  describe('toggle behavior', () => {
    it('shows "Hide preview" when open', () => {
      act(() => {
        render(<PipelineArrow id="base" result={makeResult()} />, container);
      });

      const btn = container.querySelector('.pl-preview-btn')!;
      expect(btn.textContent).toContain('Preview');

      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(btn.textContent).toContain('Hide preview');
    });

    it('hides preview content when closed', () => {
      act(() => {
        render(<PipelineArrow id="base" result={makeResult()} />, container);
      });

      const btn = container.querySelector('.pl-preview-btn')!;

      // Open
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(container.querySelector('.pl-mini-preview')).toBeTruthy();

      // Close
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(container.querySelector('.pl-mini-preview')).toBeFalsy();
    });

    it('tracks open state in _previewOpen', () => {
      act(() => {
        render(<PipelineArrow id="lk0" result={makeResult()} />, container);
      });

      expect(_previewOpen.has('lk0')).toBe(false);

      const btn = container.querySelector('.pl-preview-btn')!;
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(_previewOpen.has('lk0')).toBe(true);

      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(_previewOpen.has('lk0')).toBe(false);
    });
  });

  // ── onOpen callback ──────────────────────────────────────────────────────

  describe('onOpen callback', () => {
    it('calls onOpen with the arrow id when preview is opened', () => {
      const onOpen = vi.fn();

      act(() => {
        render(<PipelineArrow id="lk0" onOpen={onOpen} />, container);
      });

      const btn = container.querySelector('.pl-preview-btn')!;
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith('lk0');
    });

    it('does not call onOpen when preview is closed', () => {
      const onOpen = vi.fn();

      act(() => {
        render(<PipelineArrow id="base" onOpen={onOpen} />, container);
      });

      const btn = container.querySelector('.pl-preview-btn')!;

      // Open first
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onOpen).toHaveBeenCalledTimes(1);

      // Close
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onOpen).toHaveBeenCalledTimes(1); // no additional call
    });

    it('calls onOpen each time preview is re-opened', () => {
      const onOpen = vi.fn();

      act(() => {
        render(<PipelineArrow id="base" onOpen={onOpen} />, container);
      });

      const btn = container.querySelector('.pl-preview-btn')!;

      // Open
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onOpen).toHaveBeenCalledTimes(1);

      // Close
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      // Re-open
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onOpen).toHaveBeenCalledTimes(2);
    });
  });
});
