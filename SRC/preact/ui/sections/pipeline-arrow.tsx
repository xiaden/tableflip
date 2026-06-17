/**
 * Pipeline arrow connector — visual arrow between pipeline stages.
 *
 * Shows a vertical arrow with an optional preview toggle button.
 * When open, renders a mini-preview table below the arrow.
 *
 * Ported from SRC/js/ui/views/pipeline-card.tsx (PipelineArrow sub-component).
 *
 * Contract: PipelineArrow | { id: string; result?: PreviewResult | null; onOpen?: (id: string) => void }
 *   JSX arrow connector with preview toggle and inline data table.
 */

import { useState } from 'react';
import { _previewOpen } from '../../query/layout-selection';
import type { PreviewResult } from '../../report/preview-builder';

export interface PipelineArrowProps {
  /** Unique ID for this arrow (e.g. "base", "lk0", "calc1"). */
  id: string;
  /** Preview result data — rendered as JSX table when open and provided. */
  result?: PreviewResult | null;
  /** Callback invoked when the preview button is clicked to open. */
  onOpen?: (id: string) => void;
}

export function PipelineArrow({ id, result, onOpen }: PipelineArrowProps) {
  const [open, setOpen] = useState(_previewOpen.has(id));

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      _previewOpen.add(id);
      onOpen?.(id);
    } else {
      _previewOpen.delete(id);
    }
  };

  const renderContent = () => {
    if (!result) {
      return (
        <em style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
          Preview not available yet
        </em>
      );
    }

    if (result.error) {
      return (
        <div style={{ fontSize: '0.72rem', color: 'var(--danger, #d32f2f)' }}>
          {result.error}
        </div>
      );
    }

    if (result.rows.length === 0) {
      return (
        <em style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
          No rows
        </em>
      );
    }

    return (
      <table className="pl-preview-table" style={{ fontSize: '0.7rem', borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            {result.headers.map(h => (
              <th key={String(h ?? '')} style={{ padding: '1px 4px', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                {String(h ?? '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, ri) => (
            <tr key={ri}>
              {result.headers.map(h => (
                <td key={String(h ?? '')} style={{ padding: '1px 4px', whiteSpace: 'nowrap' }}>
                  {row[h] != null ? String(row[h]) : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div className="pl-arrow">
      <div className="pl-arrow-line"></div>
      <div className="pl-arrow-meta">
        <button className="pl-preview-btn" onClick={toggle}>
          {open ? '▲ Hide preview' : '▼ Preview'}
        </button>
      </div>
      <div className="pl-arrow-line"></div>
      <div className="pl-arrow-head"></div>
      {open && (
        <div className="pl-mini-preview">
          {renderContent()}
        </div>
      )}
    </div>
  );
}
