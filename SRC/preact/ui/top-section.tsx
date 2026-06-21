/**
 * TopSection — Import file, Import config, and Save config buttons
 * for the right sidebar (PivotSidebar).
 *
 * Sits at the top of the sidebar and provides the three primary file
 * operations: importing a data file, importing a saved report config,
 * and exporting the current config.
 */

import { useRef, useCallback } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { triggerFileInput } from './file-loader';
import { loadSpreadsheet } from './loader';
import { saveState } from '../core/state-serializer';
import { getStore } from '../core/store';
import { toast } from '../core/utils';

/**
 * TopSection renders three vertically-stacked MUI buttons:
 * 1. "Import file" — opens the main file picker (xlsx/xls/csv/rcjson)
 * 2. "Import config" — opens a file picker filtered to .rcjson only
 * 3. "Save config" — serializes the current state and triggers download
 */
export function TopSection() {
  const configInputRef = useRef<HTMLInputElement | null>(null);

  /** Handle Import config: create a hidden file input filtered to .rcjson */
  const handleImportConfigClick = useCallback(() => {
    if (typeof document === 'undefined') return;

    // Reuse existing input if still in DOM, otherwise create one
    let input = configInputRef.current;
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = '.rcjson';
      input.style.display = 'none';
      input.addEventListener('change', async () => {
        const file = input?.files?.[0];
        if (!file) return;
        try {
          const store = getStore();
          await loadSpreadsheet(file, store);
          toast('Config loaded', 'ok');
        } catch (ex) {
          toast('Failed to load config: ' + (ex as Error).message, 'err');
        }
        // Reset so the same file can be re-selected
        input!.value = '';
      });
      document.body.appendChild(input);
      configInputRef.current = input;
    }
    input.click();
  }, []);

  /** Handle Save config: delegate to state-serializer */
  const handleSaveConfig = useCallback(() => {
    saveState();
  }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, p: 1 }}>
      <Button
        variant="contained"
        size="small"
        fullWidth
        onClick={triggerFileInput}
      >
        Import file
      </Button>
      <Button
        variant="contained"
        size="small"
        fullWidth
        onClick={handleImportConfigClick}
      >
        Import config
      </Button>
      <Button
        variant="contained"
        size="small"
        fullWidth
        onClick={handleSaveConfig}
      >
        Save config
      </Button>
    </Box>
  );
}
