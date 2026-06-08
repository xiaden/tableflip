import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  toast,
  stickyToast,
  toggleSidebar,
  renameProjectedColumn,
  dl,
  getTableColor,
  chipFgColor,
} from '../../js/core/utils.js';

describe('Utils Extended', () => {
  describe('toast()', () => {
    beforeEach(() => {
      const c = document.getElementById('toast-container');
      if (c) c.remove();
    });

    it('should create a toast element in the DOM', () => {
      toast('Hello');
      const container = document.getElementById('toast-container');
      expect(container).toBeTruthy();
      const toasts = container!.querySelectorAll('.toast');
      expect(toasts.length).toBeGreaterThanOrEqual(1);
      expect(toasts[toasts.length - 1].textContent).toBe('Hello');
    });

    it('should apply the type class', () => {
      toast('Error!', 'error');
      const container = document.getElementById('toast-container');
      const last = container!.querySelector('.toast.error');
      expect(last).toBeTruthy();
      expect(last!.textContent).toBe('Error!');
    });

    it('should not throw when called multiple times', () => {
      expect(() => {
        toast('one');
        toast('two');
        toast('three');
      }).not.toThrow();
    });
  });

  describe('stickyToast()', () => {
    beforeEach(() => {
      const c = document.getElementById('toast-container');
      if (c) c.remove();
    });

    it('should create a sticky toast with close button', () => {
      stickyToast('Persistent');
      const container = document.getElementById('toast-container');
      expect(container).toBeTruthy();
      const sticky = container!.querySelector('.toast-sticky');
      expect(sticky).toBeTruthy();
      expect(sticky!.textContent).toContain('Persistent');
      const closeBtn = sticky!.querySelector('.toast-close');
      expect(closeBtn).toBeTruthy();
    });

    it('should default to warn type when no type given', () => {
      stickyToast('Warn msg');
      const container = document.getElementById('toast-container');
      const sticky = container!.querySelector('.toast-sticky');
      expect(sticky!.className).toContain('warn');
    });

    it('should add accept button when onAccept provided', () => {
      let accepted = false;
      stickyToast('Accept?', 'info', () => { accepted = true; }, 'OK');
      const container = document.getElementById('toast-container');
      const buttons = container!.querySelectorAll('.toast-close');
      expect(buttons.length).toBe(2);
      expect(buttons[0].textContent).toBe('OK');
    });

    it('should remove element when close button clicked', () => {
      stickyToast('Dismiss me');
      const container = document.getElementById('toast-container');
      const sticky = container!.querySelector('.toast-sticky') as HTMLElement;
      expect(sticky).toBeTruthy();
      const closeBtn = sticky.querySelector('.toast-close') as HTMLButtonElement;
      closeBtn.click();
      expect(container!.querySelector('.toast-sticky')).toBeNull();
    });
  });

  describe('toggleSidebar()', () => {
    beforeEach(() => {
      if (!document.getElementById('sidebar')) {
        const sb = document.createElement('div');
        sb.id = 'sidebar';
        document.body.appendChild(sb);
      }
      if (!document.getElementById('sidebarToggle')) {
        const btn = document.createElement('button');
        btn.id = 'sidebarToggle';
        document.body.appendChild(btn);
      }
      document.getElementById('sidebar')!.classList.remove('collapsed');
    });

    it('should toggle collapsed class on sidebar', () => {
      const sb = document.getElementById('sidebar')!;
      expect(sb.classList.contains('collapsed')).toBe(false);
      toggleSidebar();
      expect(sb.classList.contains('collapsed')).toBe(true);
      toggleSidebar();
      expect(sb.classList.contains('collapsed')).toBe(false);
    });

    it('should not throw', () => {
      expect(() => toggleSidebar()).not.toThrow();
    });
  });

  describe('dl()', () => {
    it('should create an anchor, click it, and not throw', () => {
      const blob = new Blob(['test content'], { type: 'text/plain' });
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      expect(() => dl(blob, 'test.txt')).not.toThrow();
      expect(clickSpy).toHaveBeenCalledOnce();
      clickSpy.mockRestore();
    });
  });

  describe('getTableColor() — palette overflow', () => {
    it('should cycle colors when more tables than palette entries', () => {
      const db = (globalThis as any).db;
      db.tableColors = {};
      const colors = new Set<string>();
      for (let i = 0; i < 20; i++) {
        colors.add(getTableColor(`Table_${i}`));
      }
      expect(colors.size).toBeGreaterThan(0);
      expect(colors.size).toBeLessThanOrEqual(16);
    });

    it('should return a valid hex color for every table', () => {
      const db = (globalThis as any).db;
      db.tableColors = {};
      for (let i = 0; i < 20; i++) {
        const c = getTableColor(`Hex_${i}`);
        expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    });
  });

  describe('chipFgColor() — various colors', () => {
    it('should return dark text for yellow (#FFFF00)', () => {
      expect(chipFgColor('#FFFF00')).toBe('#111');
    });

    it('should return white text for dark blue (#000080)', () => {
      expect(chipFgColor('#000080')).toBe('#fff');
    });

    it('should return dark text for light gray (#D3D3D3)', () => {
      expect(chipFgColor('#D3D3D3')).toBe('#111');
    });

    it('should return white text for dark red (#8B0000)', () => {
      expect(chipFgColor('#8B0000')).toBe('#fff');
    });

    it('should handle lowercase hex', () => {
      expect(chipFgColor('#ffffff')).toBe('#111');
      expect(chipFgColor('#000000')).toBe('#fff');
    });

    it('should return default for non-hex string', () => {
      expect(chipFgColor('rgb(255,255,255)')).toBe('#111');
    });

    it('should return default for undefined input', () => {
      expect(chipFgColor(undefined as any)).toBe('#111');
    });
  });

  describe('renameProjectedColumn()', () => {
    it('should return false when alias not found in column map', () => {
      const db = (globalThis as any).db;
      db.base = 'Orders';
      db.lookups = [];
      db.calcStages = [];
      db.selCols = null;
      db.stacks = [];
      const result = renameProjectedColumn('NonExistentAlias');
      expect(result).toBe(false);
    });
  });
});
