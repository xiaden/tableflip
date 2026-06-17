import type { ReactNode, CSSProperties } from 'react';
import ChipMUI from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { TABLE_PALETTE, chipFgColor } from '../../core/utils';

export interface ChipProps {
  col: string;
  label: string;
  colorClass?: string;
  selected?: boolean;
  draggable?: boolean;
  tooltip?: string;
  badge?: string;
  badgeTooltip?: string;
  className?: string;
  chipClass?: string;
  dataAttrs?: Record<string, string>;
  inlineStyle?: string;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDblClick?: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  children?: ReactNode;
}

/** Extract hex color from a colorClass like 'chip-c3' → TABLE_PALETTE[3]. */
function parseChipColor(colorClass: string): string | undefined {
  const m = colorClass.match(/chip-c(\d+)/);
  if (!m) return undefined;
  return TABLE_PALETTE[parseInt(m[1], 10)];
}

/** Parse a CSS text string (e.g. "background:#f00;color:#fff") into a React CSSProperties object. */
function parseInlineStyle(css: string): CSSProperties {
  const result: Record<string, string> = {};
  for (const part of css.split(';')) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key && value) {
      const camelKey = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      result[camelKey] = value;
    }
  }
  return result as CSSProperties;
}

/**
 * Column chip component wrapping MUI Chip with color, tooltip, badge, and drag support.
 *
 * Renders a compact, draggable chip representing a column in the layout/catalog UI.
 * Supports palette-based coloring via `colorClass` (e.g. 'chip-c3'), selection highlighting,
 * optional tooltip wrapping, badge indicators for warnings, and full drag-and-drop event handling.
 * Inline CSS strings can be applied via `inlineStyle` for ad-hoc styling.
 */
export function Chip({
  col,
  label,
  colorClass = '',
  selected = false,
  draggable = true,
  tooltip = '',
  badge = '',
  badgeTooltip = '',
  className = '',
  chipClass = 'chip',
  dataAttrs,
  inlineStyle,
  onClick,
  onContextMenu,
  onDblClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: ChipProps) {
  const bgColor = parseChipColor(colorClass);
  const fg = bgColor ? chipFgColor(bgColor) : undefined;

  const classes = [
    chipClass,
    selected ? 'on' : '',
    colorClass,
    className,
  ].filter(Boolean).join(' ');

  const chipSx = {
    fontSize: '0.75rem',
    cursor: draggable ? 'grab' : 'pointer',
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
    borderLeft: '3px solid var(--border)',
    '&:active': { cursor: 'grabbing' },
    ...(bgColor && {
      '--chip-color': bgColor,
      '--chip-fg': fg,
      ...(selected
        ? {
            backgroundColor: bgColor,
            color: fg,
            borderColor: bgColor,
            borderLeft: `3px solid ${bgColor}`,
            '&:hover': { backgroundColor: bgColor },
          }
        : {
            borderLeft: `3px solid ${bgColor}`,
            '&:hover': { borderColor: bgColor, color: bgColor },
          }),
    }),
  };

  const labelContent = (
    <>
      {label}
      {badge && (
        <span
          className="chip-warn-badge"
          data-autowarn={col}
          title={badgeTooltip}
        >
          {badge}
        </span>
      )}
    </>
  );

  const chipEl = (
    <ChipMUI
      label={labelContent}
      draggable={draggable}
      className={classes}
      sx={chipSx}
      data-col={col}
      {...(dataAttrs || {})}
      {...(inlineStyle ? { style: parseInlineStyle(inlineStyle) } : {})}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDblClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    />
  );

  if (tooltip) {
    return (
      <Tooltip title={tooltip} arrow>
        {chipEl}
      </Tooltip>
    );
  }

  return chipEl;
}
