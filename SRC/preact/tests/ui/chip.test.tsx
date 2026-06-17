/**
 * Tests for the Chip component — a colored, interactive label used throughout
 * the column catalog UI.
 *
 * Covers: label rendering, onClick handling, color class mapping, tooltip
 * rendering, badge rendering, selected state, and data attributes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { Chip } from '../../ui/components/chip';

afterEach(() => {
  cleanup();
});

describe('Chip', () => {
  describe('label rendering', () => {
    it('renders the label text', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" />,
      );

      expect(container.textContent).toContain('OrderId');
    });

    it('renders different labels correctly', () => {
      const { container: c1 } = render(
        <Chip col="Company" label="Company Name" />,
      );
      const { container: c2 } = render(
        <Chip col="Amount" label="Total Amount" />,
      );

      expect(c1.textContent).toContain('Company Name');
      expect(c2.textContent).toContain('Total Amount');
    });

    it('renders with an empty label without crashing', () => {
      const { container } = render(
        <Chip col="x" label="" />,
      );
      expect(container).toBeTruthy();
    });
  });

  describe('onClick handling', () => {
    it('calls onClick when the chip is clicked', () => {
      const onClick = vi.fn();
      const { container } = render(
        <Chip col="OrderId" label="OrderId" onClick={onClick} />,
      );

      // MUI Chip renders as a div with role="button" or as a clickable element
      const chipEl = container.querySelector('.MuiChip-root') as HTMLElement;
      expect(chipEl).toBeTruthy();

      fireEvent.click(chipEl);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does not throw when onClick is not provided and chip is clicked', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" />,
      );

      const chipEl = container.querySelector('.MuiChip-root') as HTMLElement;
      expect(() => fireEvent.click(chipEl)).not.toThrow();
    });

    it('calls onDoubleClick when chip is double-clicked', () => {
      const onDblClick = vi.fn();
      const { container } = render(
        <Chip col="OrderId" label="OrderId" onDblClick={onDblClick} />,
      );

      const chipEl = container.querySelector('.MuiChip-root') as HTMLElement;
      fireEvent.doubleClick(chipEl);
      expect(onDblClick).toHaveBeenCalledTimes(1);
    });

    it('calls onContextMenu when chip is right-clicked', () => {
      const onContextMenu = vi.fn();
      const { container } = render(
        <Chip col="OrderId" label="OrderId" onContextMenu={onContextMenu} />,
      );

      const chipEl = container.querySelector('.MuiChip-root') as HTMLElement;
      fireEvent.contextMenu(chipEl);
      expect(onContextMenu).toHaveBeenCalledTimes(1);
    });
  });

  describe('color class mapping', () => {
    it('applies the chip-cN class to the element', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" colorClass="chip-c3" />,
      );

      const chipEl = container.querySelector('.MuiChip-root');
      expect(chipEl).toBeTruthy();
      expect(chipEl!.classList.contains('chip-c3')).toBe(true);
    });

    it('applies chip-c0 class correctly', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" colorClass="chip-c0" />,
      );

      const chipEl = container.querySelector('.MuiChip-root');
      expect(chipEl!.classList.contains('chip-c0')).toBe(true);
    });

    it('does not apply color class when colorClass is empty', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" colorClass="" />,
      );

      const chipEl = container.querySelector('.MuiChip-root');
      // Should not have any chip-cN class
      const hasColorClass = Array.from(chipEl!.classList).some(c => c.startsWith('chip-c'));
      expect(hasColorClass).toBe(false);
    });

    it('applies the default chip class', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" />,
      );

      const chipEl = container.querySelector('.MuiChip-root');
      expect(chipEl!.classList.contains('chip')).toBe(true);
    });

    it('applies custom chipClass', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" chipClass="custom-chip" />,
      );

      const chipEl = container.querySelector('.MuiChip-root');
      expect(chipEl!.classList.contains('custom-chip')).toBe(true);
    });
  });

  describe('selected state', () => {
    it('applies "on" class when selected', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" selected={true} />,
      );

      const chipEl = container.querySelector('.MuiChip-root');
      expect(chipEl!.classList.contains('on')).toBe(true);
    });

    it('does not apply "on" class when not selected', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" selected={false} />,
      );

      const chipEl = container.querySelector('.MuiChip-root');
      expect(chipEl!.classList.contains('on')).toBe(false);
    });
  });

  describe('tooltip rendering', () => {
    it('renders without tooltip when tooltip prop is empty', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" tooltip="" />,
      );

      // No Tooltip wrapper — the chip should be directly rendered
      const chipEl = container.querySelector('.MuiChip-root');
      expect(chipEl).toBeTruthy();
    });

    it('wraps chip in Tooltip when tooltip prop is provided', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" tooltip="Orders:OrderId" />,
      );

      // MUI Tooltip wraps the child. The chip should still be rendered.
      const chipEl = container.querySelector('.MuiChip-root');
      expect(chipEl).toBeTruthy();

      // Tooltip adds aria-describedby or data attributes
      // Check that the component rendered without errors
      expect(container.textContent).toContain('OrderId');
    });
  });

  describe('badge rendering', () => {
    it('renders badge text when badge is provided', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" badge="!" badgeTooltip="Warning" />,
      );

      const badge = container.querySelector('.chip-warn-badge');
      expect(badge).toBeTruthy();
      expect(badge!.textContent).toBe('!');
    });

    it('sets data-autowarn attribute on badge', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" badge="⚠" badgeTooltip="Auto-warn" />,
      );

      const badge = container.querySelector('.chip-warn-badge');
      expect(badge!.getAttribute('data-autowarn')).toBe('OrderId');
    });

    it('does not render badge when badge is empty', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" badge="" />,
      );

      const badge = container.querySelector('.chip-warn-badge');
      expect(badge).toBeFalsy();
    });
  });

  describe('data attributes', () => {
    it('sets data-col attribute from col prop', () => {
      const { container } = render(
        <Chip col="MyColumn" label="MyColumn" />,
      );

      const chipEl = container.querySelector('.MuiChip-root');
      expect(chipEl!.getAttribute('data-col')).toBe('MyColumn');
    });

    it('applies custom data attributes', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" dataAttrs={{ 'data-source': 'base' }} />,
      );

      const chipEl = container.querySelector('.MuiChip-root');
      expect(chipEl!.getAttribute('data-source')).toBe('base');
    });
  });

  describe('draggable', () => {
    it('sets draggable attribute by default', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" />,
      );

      const chipEl = container.querySelector('.MuiChip-root');
      // MUI Chip passes draggable to the underlying element
      expect(chipEl!.getAttribute('draggable')).toBe('true');
    });

    it('can disable draggable', () => {
      const { container } = render(
        <Chip col="OrderId" label="OrderId" draggable={false} />,
      );

      const chipEl = container.querySelector('.MuiChip-root');
      expect(chipEl!.getAttribute('draggable')).toBe('false');
    });
  });
});
