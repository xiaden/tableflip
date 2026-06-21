/**
 * Filter modal — dialog wrapping the FilterList component.
 *
 * Renders the existing FilterList inside a Modal shell with an "Add filter"
 * button to create new empty filter conditions and a "Done" button to close.
 */

import Button from '@mui/material/Button';
import { Modal } from './components/modal';
import { FilterList, addFilter } from './sections/filter-list';

export interface FilterModalProps {
  open: boolean;
  onClose: () => void;
}

export function FilterModal({ open, onClose }: FilterModalProps) {
  return (
    <Modal
      open={open}
      title="Filters"
      onClose={onClose}
      buttons={[
        { label: 'Done', primary: true, action: onClose },
      ]}
    >
      <div style={{ marginBottom: 8 }}>
        <Button variant="outlined" size="small" onClick={addFilter}>
          + Add filter
        </Button>
      </div>
      <FilterList />
    </Modal>
  );
}
