/**
 * MenuBar — horizontal menu bar with File, Format, and Config dropdown menus.
 *
 * File menu: import file (load spreadsheets), import/export config, export report (Excel/CSV).
 * Format menu: Layout modal (grouping, aggregation, subtotals) and Stacks modal.
 * Config menu: Sorting and Filtering modals.
 */

import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemText from '@mui/material/ListItemText';
import { triggerFileInput } from './file-loader';
import { loadSpreadsheet } from './loader';
import { saveState } from '../core/state-serializer';
import { exportAs } from './export';
import { getStore } from '../core/store';
import { useStore } from './useStore';
import { LayoutModal } from './layout-modal';
import { StacksModal } from './stacks-modal';
import { FilterModal } from './filter-modal';
import { SortModal } from './sort-modal';

export function MenuBar() {
  const hasResult = useStore(s => s.result != null);

  const [anchorEl, setAnchorEl] = useState<Record<string, HTMLElement | null>>({
    file: null, format: null, config: null,
  });

  // Submenu state for "Export report"
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);

  // Layout modal state
  const [layoutOpen, setLayoutOpen] = useState(false);

  // Stacks modal state
  const [stacksOpen, setStacksOpen] = useState(false);

  // Filter modal state
  const [filterOpen, setFilterOpen] = useState(false);

  // Sort modal state
  const [sortOpen, setSortOpen] = useState(false);

  const open = (menu: string) => (e: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(prev => ({ ...prev, [menu]: e.currentTarget }));
  };

  const close = (menu: string) => () => {
    setAnchorEl(prev => ({ ...prev, [menu]: null }));
  };

  // ── File menu actions ──────────────────────────────────────────────────────

  const handleImportFile = useCallback(() => {
    triggerFileInput();
    close('file')();
  }, []);

  const handleImportConfig = useCallback(() => {
    close('file')();
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.rcjson';
    input.style.display = 'none';
    input.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file) {
        const store = getStore();
        await loadSpreadsheet(file, store);
      }
      // Clean up the temporary input element
      if (typeof document !== 'undefined' && input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };
    document.body.appendChild(input);
    input.click();
  }, []);

  const handleExportConfig = useCallback(() => {
    saveState();
    close('file')();
  }, []);

  const handleExportExcel = useCallback(() => {
    exportAs('xlsx');
    setExportAnchor(null);
    close('file')();
  }, []);

  const handleExportCsv = useCallback(() => {
    exportAs('csv');
    setExportAnchor(null);
    close('file')();
  }, []);

  const handleExportReportClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    setExportAnchor(e.currentTarget);
  }, []);

  const handleExportSubmenuClose = useCallback(() => {
    setExportAnchor(null);
  }, []);

  return (
    <Box sx={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', px: 1 }}>
      <Button onClick={open('file')} size="small" sx={{ color: 'var(--text)', textTransform: 'none' }}>File</Button>
      <Menu anchorEl={anchorEl.file} open={Boolean(anchorEl.file)} onClose={close('file')}>
        <MenuItem onClick={handleImportFile}>
          <ListItemText>Import file</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleImportConfig}>
          <ListItemText>Import config</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleExportConfig}>
          <ListItemText>Export config</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={handleExportReportClick}
          disabled={!hasResult}
          sx={{ pr: hasResult ? '32px' : undefined }}
        >
          <ListItemText>Export report</ListItemText>
          {hasResult && <Box component="span" sx={{ ml: 1, fontSize: '0.7em' }}>▸</Box>}
        </MenuItem>
      </Menu>

      {/* Export report submenu */}
      <Menu
        anchorEl={exportAnchor}
        open={Boolean(exportAnchor)}
        onClose={handleExportSubmenuClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <MenuItem onClick={handleExportExcel}>
          <ListItemText>Excel</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleExportCsv}>
          <ListItemText>CSV</ListItemText>
        </MenuItem>
      </Menu>

      <Button onClick={open('format')} size="small" sx={{ color: 'var(--text)', textTransform: 'none' }}>Format</Button>
      <Menu anchorEl={anchorEl.format} open={Boolean(anchorEl.format)} onClose={close('format')}>
        <MenuItem onClick={() => { setLayoutOpen(true); close('format')(); }}>Layout</MenuItem>
        <MenuItem onClick={() => { setStacksOpen(true); close('format')(); }}>Stacks</MenuItem>
      </Menu>
      <Button onClick={open('config')} size="small" sx={{ color: 'var(--text)', textTransform: 'none' }}>Config</Button>
      <Menu anchorEl={anchorEl.config} open={Boolean(anchorEl.config)} onClose={close('config')}>
        <MenuItem onClick={() => { setSortOpen(true); close('config')(); }}>Sorting</MenuItem>
        <MenuItem onClick={() => { setFilterOpen(true); close('config')(); }}>Filtering</MenuItem>
      </Menu>

      <LayoutModal open={layoutOpen} onClose={() => setLayoutOpen(false)} />
      <StacksModal open={stacksOpen} onClose={() => setStacksOpen(false)} />
      <FilterModal open={filterOpen} onClose={() => setFilterOpen(false)} />
      <SortModal open={sortOpen} onClose={() => setSortOpen(false)} />
    </Box>
  );
}
