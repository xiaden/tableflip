/**
 * Overlay Grouping Layer — consumes BandResultSet from the report engine and
 * produces OverlayDescriptor[] for rendering consumers (grid, export).
 *
 * This is a pure function module with no global state dependency. It walks
 * parent rows sequentially, detects group boundaries by match-key transitions
 * (using a GroupBoundaryDetector helper), and emits ParentDescriptor,
 * BandSectionDescriptor, and BandRowDescriptor entries that describe the
 * rendered overlay structure.
 *
 * Band rows are emitted once per group (at the end of the group, when the
 * match key changes), not after every parent row.
 */

import type {
  BandResultSet,
  OverlayDescriptor,
  DetailBandSpec,
} from '../types';
import { buildBandChildIndex, makeKeyValue } from './engine';

/**
 * Tracks match-key transitions across parent rows to detect group boundaries.
 * Each band has its own detector, keyed by the band's parent-side key aliases.
 *
 * Group boundaries are determined by match-key transitions in the parent data,
 * not by _band_id transitions in interleaved data. The first row always starts
 * a new group.
 */
class GroupBoundaryDetector {
  private prevMatchValue: string | undefined = undefined;
  private readonly keyAliases: string[];

  constructor(keyAliases: string[]) {
    this.keyAliases = keyAliases;
  }

  /**
   * Check if this parent row starts a new group.
   * A new group begins when the match key value differs from the previous row.
   * The first row always starts a new group.
   *
   * Updates internal state on each call — must be called sequentially.
   */
  isNewGroup(parentRow: Record<string, unknown>): boolean {
    const currentValue = makeKeyValue(parentRow, this.keyAliases);
    if (this.prevMatchValue === undefined || currentValue !== this.prevMatchValue) {
      this.prevMatchValue = currentValue;
      return true;
    }
    return false;
  }

  /**
   * Get the match key value from a parent row.
   * Used for BandSectionDescriptor.matchValue — returns the string produced
   * by makeKeyValue (ASCII-safe concatenation for composite keys).
   */
  getCurrentMatchValue(parentRow: Record<string, unknown>): unknown {
    return makeKeyValue(parentRow, this.keyAliases);
  }
}

/**
 * Build an ordered array of overlay descriptors from band result data.
 *
 * Walks parent rows, detects group boundaries via match-key transitions,
 * and emits parent / band-section / band-row descriptors.
 *
 * Band rows are emitted at the END of each group (when the match key changes
 * or at the end of parent data), not after every parent row. This produces
 * the "one band section per group boundary" structure described in the DD.
 *
 * @param bandResult - The BandResultSet from the report engine (flat parent
 *   rows + separate band result sets).
 * @param detailBands - The DetailBandSpec array from the report spec, used to
 *   determine enabled bands and their key pairs / columns.
 * @returns An ordered array of OverlayDescriptor entries for rendering.
 */
export function buildOverlayDescriptors(
  bandResult: BandResultSet,
  detailBands: DetailBandSpec[],
): OverlayDescriptor[] {
  // Edge case: empty parent rows → empty output
  if (bandResult.parentRows.length === 0) {
    return [];
  }

  // Determine enabled bands that have query results
  const enabledBands = detailBands.filter(band => {
    if (band.enabled === false) return false;
    return bandResult.bandResults.some(br => br.band.id === band.id);
  });

  // Edge case: no enabled bands → parent descriptors only
  if (enabledBands.length === 0) {
    return bandResult.parentRows.map(row => ({
      type: 'parent' as const,
      data: row,
      columns: bandResult.parentCols,
    }));
  }

  // Build child index for O(1) lookup by band → key → rows
  const childIndex = buildBandChildIndex(bandResult.bandResults);

  // Create boundary detectors per band
  const detectors = new Map<string, GroupBoundaryDetector>();
  for (const band of enabledBands) {
    const keyAliases = band.keyPairs.map(p => p.left);
    detectors.set(band.id, new GroupBoundaryDetector(keyAliases));
  }

  const result: OverlayDescriptor[] = [];

  // Track the match value of the current group's first row, per band.
  // Updated after each boundary flush to start tracking the new group.
  const groupMatchValues = new Map<string, string>();
  let hasGroup = false;

  /**
   * Flush the pending group: emit BandSectionDescriptor + BandRowDescriptors
   * for each enabled band, using the group's tracked match values.
   */
  const flushGroup = (): void => {
    for (const band of enabledBands) {
      const matchValue = groupMatchValues.get(band.id) as string;

      // Emit band section header
      result.push({
        type: 'band-section',
        bandId: band.id,
        bandLabel: bandResult.bandLabels[band.id] ?? band.id,
        bandColumns: band.cols,
        matchValue,
        depth: 0,
      });

      // Look up matching child rows from the index
      const bandIdx = childIndex.get(band.id);
      const children = bandIdx?.get(matchValue) ?? [];
      for (const childRow of children) {
        result.push({
          type: 'band-row',
          bandId: band.id,
          data: childRow,
          columns: band.cols,
          depth: 0,
        });
      }
    }
  };

  // Walk parent rows sequentially
  for (const parentRow of bandResult.parentRows) {
    let boundaryDetected = false;

    // Check all bands' detectors — isNewGroup advances internal state
    for (const band of enabledBands) {
      const detector = detectors.get(band.id) as GroupBoundaryDetector;
      if (detector.isNewGroup(parentRow)) {
        boundaryDetected = true;
      }
    }

    // If boundary detected and we have a pending group, flush it
    if (boundaryDetected && hasGroup) {
      flushGroup();
    }

    // Update group match values to current row's values
    for (const band of enabledBands) {
      const detector = detectors.get(band.id) as GroupBoundaryDetector;
      groupMatchValues.set(band.id, detector.getCurrentMatchValue(parentRow) as string);
    }
    hasGroup = true;

    // Emit parent descriptor
    result.push({
      type: 'parent',
      data: parentRow,
      columns: bandResult.parentCols,
    });
  }

  // Flush the final group
  if (hasGroup) {
    flushGroup();
  }

  return result;
}
