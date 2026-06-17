import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';

/** A single item in a context menu. `separator: true` renders a divider (label/action/checked are ignored). */
export interface CtxMenuItem {
  /** Display text for the menu item (optional for separators). */
  label?: string;
  /** Callback invoked when the item is selected (optional for separators). */
  action?: () => void;
  /** When true, a checkmark indicator is shown before the label. */
  checked?: boolean;
  /** When true, renders as a horizontal divider instead of a clickable item. */
  separator?: boolean;
}

/** Props for the ContextMenu component. */
export interface ContextMenuProps {
  /** Horizontal position (pixels) where the menu anchors. */
  x: number;
  /** Vertical position (pixels) where the menu anchors. */
  y: number;
  /** Menu items to display. Separators render as dividers. */
  items: CtxMenuItem[];
  /** Called when the menu should close (click outside or Escape). */
  onClose: () => void;
}

/**
 * Renders a positioned context menu at the given (x, y) coordinates using MUI Menu.
 * Each item is rendered as a MenuItem with an optional checkmark prefix.
 * The menu closes when the user clicks outside it or presses Escape.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  return (
    <Menu
      open={true}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: y, left: x }}
      slotProps={{
        paper: {
          sx: {
            minWidth: 140,
            '& .MuiMenuItem-root': { fontSize: '0.82rem', py: 0.5, px: 1.5 },
          },
        },
      }}
    >
      {items.map((item, i) => {
        if (item.separator) return <Divider key={i} />;
        return (
          <MenuItem
            key={i}
            onClick={() => { onClose(); item.action!(); }}
          >
            {item.checked ? '✓ ' : ''}{item.label}
          </MenuItem>
        );
      })}
    </Menu>
  );
}
