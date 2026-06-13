import { getStore } from '../core/store';

/**
 * Switches the active tab by updating the store.
 * @param name - Tab name ('query', 'preview', 'results')
 */
export function switchTab(name: string): void {
  getStore().update(draft => {
    draft.activeTab = name;
  });
}
