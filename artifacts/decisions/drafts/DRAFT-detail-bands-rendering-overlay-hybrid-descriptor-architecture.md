# ADR-DRAFT: Detail Bands Rendering Overlay — Hybrid Descriptor Architecture

**Status:** Proposed  
**Date:** 2026-06-15  
**Tags:** detail-bands, rendering, overlay, architecture, engine, export, grid  
**Source Log:** rnd-dd-author#L27  

## Context

Detail bands are currently implemented as data interleaving — runDetailBandsMode() calls interleaveRows() to physically merge band rows into the result set as data rows with null-padding. The export layer then spends 200+ lines in applyBandGroup()/buildBandColumnLayout() undoing this interleaving to produce a parent-column-aligned layout. Bands are treated as data when they are actually rendering artifacts. This prevents: hidden match columns, nested bands, per-group band emission (bands emit after every parent row instead of once per group), and clean separation between data retrieval and rendering composition. Three options were evaluated by RnD-Ideator and RnD-Architect subagents with AG Grid Community capability research by Support-Researcher.

## Decision

Adopt a Hybrid Overlay Descriptor architecture for detail bands rendering. The engine returns flat parent rows plus separate band result sets (BandResultSet) without interleaving. A shared grouping module (overlay-grouping.ts in the Report layer) produces OverlayDescriptor[] — a flat ordered array of parent/band-section/band-row descriptors that declaratively describe the rendered output. Grid and export consumers iterate descriptors to render in their own format. Grid uses AG Grid Community full-width rows for band section headers. Band data rows remain pre-stitched into a unified column set (AG Grid Community limitation — master/detail and tree data are Enterprise-only). Group boundaries are detected by match key transitions in parent data, not by _band_id transitions in interleaved data.

## Consequences

- Engine output contract changes: runDetailBandsMode() returns BandResultSet instead of interleaved ResultSet rows
- New module overlay-grouping.ts in Report layer produces OverlayDescriptor[] from BandResultSet
- Null-padding moves from engine (data concern) to grid adapter (rendering concern)
- applyBandGroup() and buildBandColumnLayout() in export.ts are replaced by descriptor consumer
- Grid gains full-width row rendering for band section headers via AG Grid isFullWidthRow + fullWidthCellRenderer
- Match columns no longer need to be in selCols — they're used for grouping detection, not display
- Band data rows remain pre-stitched into unified column set for AG Grid Community (Enterprise features unavailable)
- Nested bands are structurally supported via depth field on descriptors, but UI deferred
- Four-phase migration required: (1) grouping layer + flat engine, (2) grid overlays, (3) export overlays, (4) nested bands
- All 98+ existing band export tests must be rewritten in Phase 3

## References

- Design document: artifacts/designs/pending/DD-detail-bands-rendering-overlay.md
- Original bands design: artifacts/designs/completed/DD-subreport-detail-rows.md
- Export layout v2: artifacts/designs/completed/DD-band-export-v2.md
- Bands feature orientation: .opencode/skills/bands-feature-orientation/SKILL.md
- Decision log: artifacts/logs/rnd-dd-author.log.jsonl L27-L29
