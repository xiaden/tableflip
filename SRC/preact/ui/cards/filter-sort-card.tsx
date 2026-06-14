/**
 * Filter and sort configuration card.
 *
 * Renders filter conditions, sort conditions, and action buttons to add
 * new filters and sorts. Uses FilterList and SortList section components.
 *
 * Ported from SRC/js/ui/views/filter-sort-card.tsx. Key differences:
 * - Composes Preact section components instead of inline sub-components
 * - Uses store.subscribe() for reactive updates
 * - No window assignments for addFilter/addSort
 */

import { useState, useEffect } from 'preact/hooks';
import { getStore } from '../../core/store';
import { FilterList, addFilter } from '../sections/filter-list';
import { SortList, addSort } from '../sections/sort-list';
import { Tip } from '../components/tip';
import type { AppState } from '../../types';

export function FilterSortCard() {
  const [state, setState] = useState<AppState>(getStore().getState());

  useEffect(() => getStore().subscribe(s => setState(s)), []);

  const base = state.base;
  if (!base) return null;

  return (
    <div id="filterSortCard" class="card">
      {/* Filters section */}
      <div style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-weight:600;font-size:0.82rem">Filters <Tip text="Narrow your results by adding conditions. Only rows that match ALL active filters will appear. For example: Region = 'East' AND Status = 'Active'." /></span>
          <button
            class="btn btn-ghost"
            style="font-size:0.72rem;padding:2px 8px"
            onClick={addFilter}
            title="Add a new filter condition"
          >
            {'＋'} Add filter
          </button>
        </div>
        <FilterList />
      </div>

      {/* Sorts section */}
      <div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-weight:600;font-size:0.82rem">Sort <Tip text="Control the order rows appear in your report. Level 1 is the primary sort, Level 2 breaks ties, and so on. Like sorting by Last Name, then First Name." /></span>
          <button
            class="btn btn-ghost"
            style="font-size:0.72rem;padding:2px 8px"
            onClick={addSort}
            title="Add another sort level"
          >
            {'＋'} Add sort
          </button>
        </div>
        <SortList />
      </div>
    </div>
  );
}
