import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, cleanup } from '@testing-library/react';
import { getStore, initStore } from '../../core/store';
import { PipelineCard } from '../../ui/cards/pipeline-card';
import type { DbTable } from '../../types';

function makeTable(id: string, name: string): DbTable {
  return { id, name, cols: ['A', 'B'], rowCount: 5 };
}

describe('PipelineCard — source column UI', () => {
  beforeEach(() => {
    initStore({
      tables: {
        t1: makeTable('t1', 'Orders'),
        t2: makeTable('t2', 'Customers'),
      },
      base: 't1',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the "Show source sheet column" checkbox when base is selected', () => {
    const { container } = render(<PipelineCard />);

    const label = container.querySelector('label');
    expect(label).toBeTruthy();
    expect(label!.textContent).toContain('Show source sheet column');
  });

  it('checkbox is unchecked by default (includeSourceColumn is false)', () => {
    const { container } = render(<PipelineCard />);

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(false);
  });

  it('toggling checkbox updates store.includeSourceColumn', () => {
    const { container } = render(<PipelineCard />);

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    act(() => {
      checkbox.click();
    });

    expect(getStore().getState().includeSourceColumn).toBe(true);
  });

  it('TextField for sourceColumnName is NOT visible when checkbox is unchecked', () => {
    const { container } = render(<PipelineCard />);

    const textField = container.querySelector('input[placeholder="Source Sheet"]');
    expect(textField).toBeFalsy();
  });

  it('TextField for sourceColumnName IS visible when includeSourceColumn is true', () => {
    getStore().update(draft => {
      draft.includeSourceColumn = true;
    });

    const { container } = render(<PipelineCard />);

    const textField = container.querySelector('input[placeholder="Source Sheet"]');
    expect(textField).toBeTruthy();
  });

  it('changing TextField value updates store.sourceColumnName', () => {
    getStore().update(draft => {
      draft.includeSourceColumn = true;
    });

    const { container } = render(<PipelineCard />);

    const textField = container.querySelector('input[placeholder="Source Sheet"]') as HTMLInputElement;
    expect(textField).toBeTruthy();

    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      nativeInputValueSetter.call(textField, 'Origin');
      textField.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(getStore().getState().sourceColumnName).toBe('Origin');
  });
});
