/**
 * Sort modal — dialog wrapping the SortList component.
 *
 * Renders the existing SortList inside a Modal shell with an "Add sort"
 * button to create new empty sort conditions and a "Done" button to close.
 */

import Button from '@mui/material/Button';
import { Modal } from './components/modal';
import { SortList, addSort } from './sections/sort-list';

export interface SortModalProps {
  open: boolean;
  onClose: () => void;
}

export function SortModal({ open, onClose }: SortModalProps) {
  return (
    <Modal
      open={open}
      title="Sorting"
      onClose={onClose}
      buttons={[
        { label: 'Done', primary: true, action: onClose },
      ]}
    >
      <div style={{ marginBottom: 8 }}>
        <Button variant="outlined" size="small" onClick={addSort}>
          + Add sort
        </Button>
      </div>
      <SortList />
    </Modal>
  );
}
