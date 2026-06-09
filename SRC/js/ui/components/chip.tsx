import type { ComponentChildren } from 'preact';

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
  onClick?: (e: MouseEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
  onDblClick?: (e: MouseEvent) => void;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  children?: ComponentChildren;
}

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
  const classes = [
    chipClass,
    selected ? 'on' : '',
    colorClass,
    className,
  ].filter(Boolean).join(' ');

  const extraAttrs: Record<string, string> = { ...dataAttrs };

  return (
    <span
      class={classes}
      draggable={draggable}
      data-col={col}
      data-tip={tooltip || undefined}
      style={inlineStyle || undefined}
      {...extraAttrs}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDblClick={onDblClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {label}
      {badge && (
        <span
          class="chip-warn-badge"
          data-autowarn={col}
          title={badgeTooltip}
        >
          {badge}
        </span>
      )}
    </span>
  );
}
