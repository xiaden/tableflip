import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';

/** Props for the Modal dialog component. */
export interface ModalProps {
  /** Whether the dialog is currently visible. */
  open: boolean;
  /** Optional title displayed in the dialog header. */
  title?: string;
  /** Called when the dialog should close (backdrop click, Escape, or Cancel button). */
  onClose?: () => void;
  /** When false, clicking the backdrop does not close the dialog. Defaults to true. */
  closeOnBackdrop?: boolean;
  /** Additional CSS class applied to the root Dialog element. */
  className?: string;
  /** Body content rendered inside DialogContent. */
  children?: ReactNode;
  /** Action buttons rendered in DialogActions. Each button's `primary` flag controls variant (contained vs outlined). The first button receives autoFocus. */
  buttons?: { label: string; action: () => void; primary?: boolean; className?: string }[];
}

/**
 * Generic modal dialog built on MUI Dialog.
 *
 * Provides a consistent modal shell with an optional title, body slot via `children`,
 * and a row of action buttons. Use `closeOnBackdrop` to control whether clicking
 * outside the dialog dismisses it. Buttons are rendered with the first receiving
 * autoFocus; mark a button `primary` to give it the contained variant.
 */
export function Modal({
  open,
  title = '',
  onClose,
  closeOnBackdrop = true,
  className = '',
  children,
  buttons = [],
}: ModalProps) {
  const handleClose = (_event: object, reason: string) => {
    if (reason === 'backdropClick' && !closeOnBackdrop) return;
    onClose?.();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      className={className}
      aria-modal="true"
      slotProps={{
        paper: {
          sx: {
            minWidth: 340,
            maxWidth: 520,
            fontSize: '0.85rem',
          },
        },
      }}
    >
      {title && (
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600, pb: 1 }}>
          {title}
        </DialogTitle>
      )}
      <DialogContent sx={{ mb: 2 }}>
        {children}
      </DialogContent>
      {buttons.length > 0 && (
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {buttons.map((btn, i) => (
            <Button
              key={i}
              variant={btn.primary ? 'contained' : 'outlined'}
              size="small"
              className={btn.className}
              onClick={btn.action}
              autoFocus={i === 0}
            >
              {btn.label}
            </Button>
          ))}
        </DialogActions>
      )}
    </Dialog>
  );
}
