import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { render, cleanup } from '@testing-library/react';
import { getStore, initStore } from '../../core/store';
import { StackSheets } from '../../ui/sections/stack-sheets';
import type { DbTable } from '../../types';

vi.mock('../../query/layout-selection', async () => {
  const actual = await vi.importActual<typeof import('../../query/layout-selection')>('../../query/layout-selection');
  return { ...actual, _afterCombineChange: vi.fn() };
});

function makeTable(id: string, name: string): DbTable {
  return { id, name, cols: ['A', 'B'], rowCount: 5 };
}

describe('StackSheets — per-chip alias TextFields', () => {
  beforeEach(() => {
    initStore({
      tables: {
        t1: makeTable('t1', 'Orders'),
        t2: makeTable('t2', 'Customers'),
        t3: makeTable('t3', 'Products'),
      },
      base: 't1',
      stacks: ['t2', 't3'],
    });
  });

  afterEach(() => {
    cleanup();
  });

  const sortedIds = ['t1', 't2', 't3'];

  it('renders chips for stacked tables', () => {
    const { container } = render(
      <StackSheets sortedIds={sortedIds} usedAsLookup={new Set()} usedAsStack={new Set(['t2', 't3'])} />,
    );

    const chips = container.querySelectorAll('.pl-stack-chip');
    expect(chips.length).toBe(2);
  });

  it('TextField per chip is NOT visible when includeSourceColumn is false', () => {
    const { container } = render(
      <StackSheets sortedIds={sortedIds} usedAsLookup={new Set()} usedAsStack={new Set(['t2', 't3'])} />,
    );

    const textFields = container.querySelectorAll('input[placeholder="Customers"], input[placeholder="Products"]');
    expect(textFields.length).toBe(0);
  });

  it('TextField per chip IS visible when includeSourceColumn is true', () => {
    getStore().update(draft => {
      draft.includeSourceColumn = true;
    });

    const { container } = render(
      <StackSheets sortedIds={sortedIds} usedAsLookup={new Set()} usedAsStack={new Set(['t2', 't3'])} />,
    );

    const customersField = container.querySelector('input[placeholder="Customers"]');
    const productsField = container.querySelector('input[placeholder="Products"]');
    expect(customersField).toBeTruthy();
    expect(productsField).toBeTruthy();
  });

  it('TextField shows correct value from stackAliases[tableId]', () => {
    getStore().update(draft => {
      draft.includeSourceColumn = true;
      draft.stackAliases = { t2: 'Cust Alias' };
    });

    const { container } = render(
      <StackSheets sortedIds={sortedIds} usedAsLookup={new Set()} usedAsStack={new Set(['t2', 't3'])} />,
    );

    const customersField = container.querySelector('input[placeholder="Customers"]') as HTMLInputElement;
    expect(customersField).toBeTruthy();
    expect(customersField.value).toBe('Cust Alias');
  });

  it('changing TextField value updates stackAliases in store', () => {
    getStore().update(draft => {
      draft.includeSourceColumn = true;
    });

    const { container } = render(
      <StackSheets sortedIds={sortedIds} usedAsLookup={new Set()} usedAsStack={new Set(['t2', 't3'])} />,
    );

    const customersField = container.querySelector('input[placeholder="Customers"]') as HTMLInputElement;
    expect(customersField).toBeTruthy();

    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      nativeInputValueSetter.call(customersField, 'New Alias');
      customersField.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(getStore().getState().stackAliases?.t2).toBe('New Alias');
  });

  it('_afterCombineChange is called after alias change', async () => {
    getStore().update(draft => {
      draft.includeSourceColumn = true;
    });

    const { _afterCombineChange } = await import('../../query/layout-selection');
    const afterCombineSpy = vi.mocked(_afterCombineChange);
    afterCombineSpy.mockClear();

    const { container } = render(
      <StackSheets sortedIds={sortedIds} usedAsLookup={new Set()} usedAsStack={new Set(['t2', 't3'])} />,
    );

    const customersField = container.querySelector('input[placeholder="Customers"]') as HTMLInputElement;

    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      nativeInputValueSetter.call(customersField, 'Test Alias');
      customersField.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(afterCombineSpy).toHaveBeenCalled();
  });
});
