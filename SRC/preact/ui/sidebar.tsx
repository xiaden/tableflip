/**
 * Sidebar — table list with color chips, remove table, preview table.
 *
 * Converted from Preact to React + MUI.
 * Uses React state for the open/closed toggle instead of imperative DOM
 * class manipulation (toggleSidebar() from core/utils).
 *
 * DOM IDs (sidebar, sidebarToggle, dropZone, tablesList) preserved for
 * backward compatibility with any code that references them by ID.
 */

import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import { useStore } from './useStore';
import { getStore } from '../core/store';
import { getTableColor } from '../core/utils';
import { dropTable } from '../core/sqldb';
import { triggerFileInput } from './file-loader';
import { saveState } from '../core/state-serializer';

const DRAWER_WIDTH = 270;

/**
 * Sidebar component displaying loaded tables with color chips.
 * Supports removing tables and previewing table data.
 *
 * The sidebar can be collapsed/expanded via React state (sidebarOpen).
 * When collapsed, the main content area reflows to fill the space.
 */
export function Sidebar() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
    <Box
      className="sidebar-wrap"
      sx={{ position: 'relative', display: 'flex', flexShrink: 0, alignSelf: 'stretch' }}
    >
      {/* Sidebar panel */}
      <Box
        id="sidebar"
        className="sidebar"
        sx={{
          width: sidebarOpen ? DRAWER_WIDTH : 0,
          minWidth: sidebarOpen ? DRAWER_WIDTH : 0,
          background: 'var(--bg2)',
          borderRight: sidebarOpen ? '1px solid var(--border)' : 'none',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'width 0.2s ease, min-width 0.2s ease',
        }}
      >
        {/* Drop zone */}
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

        {/* Tables header */}
        <Box className="sb-sec">
          <Typography className="sb-sec-h3" sx={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', mb: 1 }}>
            Tables ({ids.length})
          </Typography>
        </Box>

        {/* Table list */}
        <Box id="tablesList" className="tables-list" sx={{ flex: 1, overflow: 'auto' }}>
          {ids.length === 0 ? (
            <Box className="empty" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px', color: 'var(--muted)' }}>
              <Box className="empty-icon" sx={{ fontSize: '1.5rem' }}>📋</Box>
              <Typography className="empty-title" sx={{ fontSize: '0.82rem' }}>No tables loaded</Typography>
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
                  sx={{
                    borderLeft: `3px solid ${color}`,
                    '&:hover': { background: 'var(--bg3)' },
                  }}
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
                      right: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: '0.8rem',
                      padding: 0,
                      color: 'var(--muted)',
                      width: 18,
                      height: 18,
                      borderRadius: '4px',
                      '&:hover': { color: 'var(--red)', background: 'rgba(248,81,73,0.1)' },
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
                      fontWeight: 500,
                      cursor: 'pointer',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      pr: '22px',
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    {t.name}
                  </Typography>
                  <Box className="tcard-meta" sx={{ fontSize: '0.7rem', color: 'var(--muted)', mt: '1px' }}>
                    {t.rowCount.toLocaleString()} rows · {t.cols.length} cols
                  </Box>
                </Box>
              );
            })
          )}
        </Box>

        {/* Save button footer */}
        {base && (
          <Box className="sidebar-footer">
            <Tooltip title="Save your current report setup (sheets, columns, filters, sort, summary) as a file you can reload later.">
              <Button
                className="sidebar-save-btn"
                variant="contained"
                size="small"
                onClick={saveState}
                sx={{
                  width: '100%',
                  height: 36,
                  px: 2,
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                  fontWeight: 500,
                  textTransform: 'none',
                  bgcolor: 'var(--accent)',
                  color: '#fff',
                  border: '1px solid var(--accent)',
                  '&:hover': { bgcolor: 'var(--accent2)', borderColor: 'var(--accent2)' },
                  '&:active': { transform: 'translateY(1px)', opacity: 0.9 },
                }}
              >
                Save Report Config
              </Button>
            </Tooltip>
          </Box>
        )}
      </Box>

      {/* Toggle button */}
      <Box
        id="sidebarToggle"
        onClick={() => setSidebarOpen(o => !o)}
        sx={{
          position: 'absolute',
          left: sidebarOpen ? DRAWER_WIDTH : 0,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 18,
          height: 42,
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
        {sidebarOpen ? '❮' : '❯'}
      </Box>
    </Box>
  );
}
