/**
 * Tests for JoinKeyPair — join key pair chip component.
 *
 * Covers: rendering left/right labels, gear icon, gear click callback.
 * Purely presentational — no store dependency.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { JoinKeyPair } from '../../ui/join-key-pair';

afterEach(() => {
  cleanup();
});

describe('JoinKeyPair', () => {
  const defaultProps = {
    leftCol: 'OrderId',
    leftTableId: 'orders',
    rightCol: 'CustId',
    rightTableId: 'customers',
    lookupIndex: 0,
    onGearClick: vi.fn(),
  };

  describe('rendering', () => {
    it('renders left column label', () => {
      const { container } = render(<JoinKeyPair {...defaultProps} />);
      expect(container.textContent).toContain('OrderId');
    });

    it('renders right column label', () => {
      const { container } = render(<JoinKeyPair {...defaultProps} />);
      expect(container.textContent).toContain('CustId');
    });

    it('renders gear icon (⚙ character)', () => {
      const { container } = render(<JoinKeyPair {...defaultProps} />);
      expect(container.textContent).toContain('\u2699');
    });

    it('sets data-join-pair attribute with lookupIndex', () => {
      const { container } = render(<JoinKeyPair {...defaultProps} lookupIndex={3} />);
      const pairEl = container.querySelector('[data-join-pair="3"]');
      expect(pairEl).toBeTruthy();
    });

    it('renders without throwing with minimal valid props', () => {
      expect(() => {
        render(<JoinKeyPair {...defaultProps} />);
      }).not.toThrow();
    });
  });

  describe('gear icon click', () => {
    it('calls onGearClick with correct lookupIndex and anchor element', () => {
      const onGearClick = vi.fn();
      const { container } = render(
        <JoinKeyPair {...defaultProps} lookupIndex={2} onGearClick={onGearClick} />,
      );

      // Find the gear button (contains ⚙)
      const gearBtn = Array.from(container.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('\u2699'),
      );
      expect(gearBtn).toBeTruthy();

      fireEvent.click(gearBtn!);
      expect(onGearClick).toHaveBeenCalledTimes(1);
      expect(onGearClick).toHaveBeenCalledWith(2, gearBtn);
    });

    it('does not throw when onGearClick is a no-op', () => {
      const { container } = render(
        <JoinKeyPair {...defaultProps} onGearClick={() => {}} />,
      );

      const gearBtn = Array.from(container.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('\u2699'),
      );

      expect(() => fireEvent.click(gearBtn!)).not.toThrow();
    });
  });
});
