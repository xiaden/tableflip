/**
 * Row explosion warning dialog.
 *
 * Displayed when stacking-mode cross-product exceeds the default row limit.
 * Shows the projected row count and the limit that was exceeded, and offers
 * the user a choice to proceed with an elevated limit or cancel the run.
 *
 * Uses the existing Modal component for consistent styling and behavior.
 */

import { Modal } from './modal';

export interface RowExplosionDialogProps {
  /** The projected number of rows that would be produced. */
  projectedCount: number;
  /** The limit that was exceeded. */
  limit: number;
  /** Called when the user clicks "Proceed anyway" — re-runs with elevated limit. */
  onProceed: () => void;
  /** Called when the user clicks "Cancel" or closes the dialog — aborts the run. */
  onCancel: () => void;
}

/**
 * Warning dialog for row explosion in stacking mode.
 *
 * Displays a message with the projected row count and the limit that was
 * exceeded. The "Proceed anyway" button re-runs the report with an elevated
 * limit (computed by the caller). The "Cancel" button aborts the run.
 */
export function RowExplosionDialog({
  projectedCount,
  limit,
  onProceed,
  onCancel,
}: RowExplosionDialogProps) {
  return (
    <Modal
      open={true}
      title="Row count warning"
      onClose={onCancel}
      closeOnBackdrop={false}
      buttons={[
        { label: 'Cancel', action: onCancel },
        { label: 'Proceed anyway', primary: true, action: onProceed, className: 'btn-warning' },
      ]}
    >
      <p style="font-size:0.82rem;line-height:1.5;margin:0 0 8px 0">
        The stacking-mode cross-product would produce{' '}
        <strong>{projectedCount.toLocaleString()}</strong> rows, which exceeds
        the limit of <strong>{limit.toLocaleString()}</strong>.
      </p>
      <p style="font-size:0.78rem;line-height:1.5;margin:0;color:var(--muted)">
        This may cause the application to slow down or become unresponsive.
        Click <em>Proceed anyway</em> to run with an elevated limit, or{' '}
        <em>Cancel</em> to abort.
      </p>
    </Modal>
  );
}
