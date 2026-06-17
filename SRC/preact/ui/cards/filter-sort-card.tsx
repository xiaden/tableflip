/**
 * Filter and sort configuration card.
 *
 * Renders filter conditions, sort conditions, and action buttons to add
 * new filters and sorts. Uses FilterList and SortList section components.
 *
 * Ported from SRC/js/ui/views/filter-sort-card.tsx. Key differences:
 * - Composes React section components instead of inline sub-components
 * - Uses useStore() for reactive updates instead of raw store.subscribe()
 * - No window assignments for addFilter/addSort
 */

import { useStore } from '../useStore';
import { FilterList, addFilter } from '../sections/filter-list';
import { SortList, addSort } from '../sections/sort-list';
import { Tip } from '../components/tip';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

/**
 * Filter and sort configuration card.
 *
 * Renders filter conditions, sort conditions, and action buttons to add
 * new filters and sorts. Uses FilterList and SortList section components.
 *
 * Returns null when no base table is selected. Delegates filter/sort mutations
 * to the section components' addFilter/addSort handlers.
 */
export function FilterSortCard() {
  const { base } = useStore(s => ({ base: s.base }));
  if (!base) return null;

  return (
    <Card id="filterSortCard" className="card">
      <CardContent>
        {/* Filters section */}
        <Box sx={{ mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <Typography sx={{ fontWeight: 600, fontSize: '0.82rem' }}>
              Filters <Tip text="Narrow your results by adding conditions. Only rows that match ALL active filters will appear. For example: Region = 'East' AND Status = 'Active'." />
            </Typography>
            <Button
              variant="text"
              size="small"
              onClick={addFilter}
              title="Add a new filter condition"
              sx={{ fontSize: '0.72rem', py: 0.25, px: 1, minWidth: 'unset' }}
            >
              {'＋'} Add filter
            </Button>
          </Box>
          <FilterList />
        </Box>

        {/* Sorts section */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <Typography sx={{ fontWeight: 600, fontSize: '0.82rem' }}>
              Sort <Tip text="Control the order rows appear in your report. Level 1 is the primary sort, Level 2 breaks ties, and so on. Like sorting by Last Name, then First Name." />
            </Typography>
            <Button
              variant="text"
              size="small"
              onClick={addSort}
              title="Add another sort level"
              sx={{ fontSize: '0.72rem', py: 0.25, px: 1, minWidth: 'unset' }}
            >
              {'＋'} Add sort
            </Button>
          </Box>
          <SortList />
        </Box>
      </CardContent>
    </Card>
  );
}
