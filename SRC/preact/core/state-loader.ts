/**
 * State Loader — reads a .rcjson file, validates, hydrates, and applies it
 * to the reactive store.
 *
 * Ported from `SRC/js/core/state-loader.ts`. Key differences:
 * - No `window.loadState` assignment
 * - No hidden `<input>` DOM element creation (file input is handled by the UI layer)
 * - Returns `Promise<LoadResult>` instead of void
 * - Takes `store: Store` as a parameter for accessing `loadedTables`
 * - `hydrateState` receives `loadedTables` from `store.getState().tables`
 */

import type { Store } from './store';
import { toast } from './utils';
import { isRecognizableConfig, STATE_VERSION } from './state-schema';
import { hydrateState } from './state-hydrator';
import { applyState } from './state-applier';

/**
 * Result of a state load operation.
 */
export interface LoadResult {
  /** Whether the load succeeded (file was parsed and applied). */
  ok: boolean;
  /** Human-readable references to missing tables, columns, or other issues. */
  brokenRefs: string[];
}

/**
 * Load a .rcjson report configuration file into the store.
 *
 * Reads the file via `FileReader`, parses JSON, validates the payload
 * against the expected schema and version, hydrates it into a state
 * object, and applies it to the store. Toast messages are shown for
 * success, warnings, and errors.
 *
 * @param file - The .rcjson file to load
 * @param store - The reactive store instance (used to access loadedTables)
 * @returns Promise resolving to `{ ok, brokenRefs }`
 */
export function loadState(file: File, store: Store): Promise<LoadResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(e.target!.result as string);
      } catch {
        toast('Could not parse state file — is it a valid .rcjson file?', 'err');
        resolve({ ok: false, brokenRefs: [] });
        return;
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        toast('Invalid state file.', 'err');
        resolve({ ok: false, brokenRefs: [] });
        return;
      }

      if (!isRecognizableConfig(payload)) {
        toast('File does not appear to be a TableFlip report configuration.', 'err');
        resolve({ ok: false, brokenRefs: [] });
        return;
      }

      if (payload.v !== STATE_VERSION) {
        toast(`Version mismatch (saved: ${JSON.stringify(payload.v)}, app: ${STATE_VERSION}). Please re-save with the current version.`, 'err');
        resolve({ ok: false, brokenRefs: [] });
        return;
      }

      const loadedTables = store.getState().tables;
      const { next, brokenRefs, nextExcludedRows } = hydrateState(payload, loadedTables);
      applyState(next, nextExcludedRows);

      if (brokenRefs.length) {
        const summary = brokenRefs.length === 1
          ? `1 item needs attention: ${brokenRefs[0]}.`
          : `${brokenRefs.length} items need attention — missing sheets or columns. Run the report to see full details.`;
        toast(`Report setup loaded with issues — ${summary}`, 'warn');
      } else {
        toast('Report setup loaded.', 'ok');
      }

      resolve({ ok: true, brokenRefs });
    };

    reader.onerror = () => {
      toast('Failed to read file.', 'err');
      resolve({ ok: false, brokenRefs: [] });
    };
    reader.readAsText(file);
  });
}
