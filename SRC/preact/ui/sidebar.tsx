/**
 * Sidebar — table list with color chips, remove table, preview table.
 *
 * Converted from Preact to React + MUI.
 * Key differences from the Preact version:
 * - React hooks from 'react' instead of 'preact/hooks'
 * - useStore(selector) replaces getStore().subscribe() pattern
 * - MUI Box for layout containers, IconButton for remove, Button for save
 * - className preserved for CSS compatibility (Phase 2 cleanup)
 * - DOM IDs (sidebar, sidebarToggle, dropZone, tablesList) preserved
 *   for toggleSidebar() utility function compatibility
 */

import { useCallback } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import { useStore } from './useStore';
import { getStore } from '../core/store';
import { getTableColor, toggleSidebar } from '../core/utils';
import { dropTable } from '../core/sqldb';
import { triggerFileInput } from './file-loader';
import { saveState } from '../core/state-serializer';

/**
 * Sidebar component displaying loaded tables with color chips.
 * Supports removing tables and previewing table data.
 */
export function Sidebar() {
  const { tables, base } = useStore(s => ({ tables: s.tables, base: s.base }));

  const ids = Object.keys(tables).sort((a, b) =>
    tables[a].name.localeCompare(tables[b].name)
  );

  const handleRemove = useCallback((id: string) => {
    dropTable(id);
    getStore().update(draft => {
      delete draft.tables[id];
      delete draft.excludedRows[id];
      delete draft.tableColors[id];
      if (draft.base === id) {
        draft.base = '';
        draft.selCols = new Set();
        draft.groupBy = [];
        draft.aggregates = [];
        draft.filters = [];
      }
    });
  }, []);

  const handlePreview = useCallback((id: string) => {
    getStore().update(draft => {
      draft.previewTableId = id;
      draft.activeTab = 'preview';
    });
  }, []);

  return (
    <>
      <Box className="sidebar-wrap" sx={{ display: 'flex', flexShrink: 0, overflow: 'hidden' }}>
        <Box id="sidebar" className="sidebar" sx={{ display: 'flex', flexDirection: 'column', width: '100%', overflow: 'hidden' }}>
          <Box className="sb-sec">
            <Box
              id="dropZone"
              onClick={triggerFileInput}
              sx={{ cursor: 'pointer' }}
            >
              <Box className="dz-icon" sx={{ fontSize: '1.5rem', textAlign: 'center' }}>📂</Box>
              <Box className="dz-main" sx={{ fontSize: '0.82rem', fontWeight: 600, textAlign: 'center' }}>Import files</Box>
              <Box className="dz-sub" sx={{ fontSize: '0.72rem', color: 'var(--muted)', textAlign: 'center' }}>Drop xlsx, csv, or rcjson here</Box>
            </Box>
          </Box>
          <Box className="sb-sec">
            <Typography variant="h6" component="h3" sx={{ fontSize: '0.82rem', fontWeight: 600, margin: 0 }}>
              Tables ({ids.length})
            </Typography>
          </Box>
          <Box id="tablesList" className="tables-list" sx={{ flex: 1, overflow: 'auto' }}>
            {ids.length === 0 ? (
              <Box className="empty" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none', padding: '16px', color: 'var(--muted)' }}>
                <Box className="empty-icon" sx={{ fontSize: '1.5rem' }}>📋</Box>
                <Typography sx={{ fontSize: '0.82rem' }}>No tables loaded</Typography>
              </Box>
            ) : (
              ids.map(id => {
                const t = tables[id];
                const color = getTableColor(id);
                return (
                  <Box
                    key={id}
                    className="tcard"
                    data-tid={id}
                    sx={{ borderLeft: `3px solid ${color}` }}
                  >
                    <IconButton
                      className="tcard-rm"
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(id);
                      }}
                      sx={{
                        position: 'absolute',
                        right: 4,
                        top: 4,
                        fontSize: '12px',
                        padding: '2px',
                        color: 'var(--muted)',
                        '&:hover': { color: '#e57373' },
                      }}
                    >
                      ✕
                    </IconButton>
                    <Typography
                      className="tcard-name"
                      title={t.name}
                      onClick={() => handlePreview(id)}
                      sx={{
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        '&:hover': { textDecoration: 'underline' },
                      }}
                    >
                      {t.name}
                    </Typography>
                    <Box className="tcard-meta" sx={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                      {t.rowCount.toLocaleString()} rows · {t.cols.length} cols
                    </Box>
                  </Box>
                );
              })
            )}
          </Box>
          {base && (
            <Box className="sidebar-footer" sx={{ padding: '8px', borderTop: '1px solid var(--border, #333)' }}>
              <Tooltip title="Save your current report setup (sheets, columns, filters, sort, summary) as a file you can reload later.">
                <Button
                  className="sidebar-save-btn"
                  variant="outlined"
                  size="small"
                  onClick={saveState}
                  sx={{ width: '100%', textTransform: 'none', fontSize: '0.78rem' }}
                >
                  Save Report Config
                </Button>
              </Tooltip>
            </Box>
          )}
        </Box>
      </Box>
      <Box
        id="sidebarToggle"
        onClick={toggleSidebar}
        sx={{
          position: 'absolute',
          left: 270,
          top: '50%',
          transform: 'translateY(-50%)',
          width: '18px',
          height: '42px',
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderLeft: 'none',
          borderRadius: '0 6px 6px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: 'var(--muted)',
          fontSize: '0.7rem',
          transition: 'left 0.2s ease, color 0.15s, background 0.15s',
          userSelect: 'none',
          zIndex: 20,
          '&:hover': { color: 'var(--text)', background: 'var(--bg3)' },
        }}
      >
        ❮
      </Box>
    </>
  );
}
