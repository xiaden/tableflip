/**
 * Pipeline arrow connector — visual arrow between pipeline stages.
 *
 * Shows a vertical arrow with an optional preview toggle button.
 * When open, renders a mini-preview table below the arrow.
 *
 * Ported from SRC/js/ui/views/pipeline-card.tsx (PipelineArrow sub-component).
 */

import { useState } from 'preact/hooks';
import { _previewOpen } from '../../query/layout-selection';

export interface PipelineArrowProps {
  /** Unique ID for this arrow (e.g. "base", "lk0", "calc1"). */
  id: string;
}

export function PipelineArrow({ id }: PipelineArrowProps) {
  const [open, setOpen] = useState(_previewOpen.has(id));

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) _previewOpen.add(id);
    else _previewOpen.delete(id);
  };

  return (
    <div class="pl-arrow">
      <div class="pl-arrow-line"></div>
      <div class="pl-arrow-meta">
        <button class="pl-preview-btn" onClick={toggle}>
          {open ? '▲ Hide preview' : '▼ Preview'}
        </button>
      </div>
      <div class="pl-arrow-line"></div>
      <div class="pl-arrow-head"></div>
      {open && (
        <div class="pl-mini-preview">
          <em style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Preview not available yet</em>
        </div>
      )}
    </div>
  );
}
