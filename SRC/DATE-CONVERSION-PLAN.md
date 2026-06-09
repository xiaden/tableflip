# Plan: Client-Side Date Format Normalization

## Problem
Date strings like `MM/DD/YYYY` pass through `coerceForSQL()` as plain TEXT into SQLite. SQLite's `strftime()` only understands ISO 8601 (`YYYY-MM-DD`), so date extraction in calculated columns returns NULL.

## Current Flow
```
XLSX (cellDates: true) → Date objects → coerceForSQL → ISO string → SQLite ✓
CSV / string dates     → plain string → coerceForSQL → raw string → SQLite ✗
```

## Solution: Normalize dates during ingestion

### Step 1: Add date format detection (`js/core/date-format.ts` — new file)

A function that samples column values and determines which date format best fits:

**Formats to detect:**
- `MM/DD/YYYY` (US format)
- `DD/MM/YYYY` (EU format)
- `DD MMM YYYY` (e.g., `25 Dec 2023`, `3-Jan-2024`)

**Detection strategy:**
1. Take a sample of non-null values from the column
2. Try each format's regex against the sample
3. For `MM/DD/YYYY` vs `DD/MM/YYYY` ambiguity (both match): check which interpretation produces valid dates (month ≤ 12, day ≤ 31). If only one is valid, pick that. If both valid, prefer MM/DD (US default) or use day > 12 disambiguation.
4. Return the detected format or `null` if no date format matches

**Exported functions:**
- `detectDateFormat(values: string[]): DateFormat | null` — samples values, returns detected format
- `normalizeDate(value: string, format: DateFormat): string | null` — converts a single date string to `YYYY-MM-DD` or returns null if invalid
- `DateFormat` type: `'mdy' | 'dmy' | 'dmmy'` (or null)

### Step 2: Integrate into ingestion (`js/ui/loader.ts`)

After `sheet_to_json` produces `rawData` (line 237) and before `insertRows` (line 256):

1. For each column, sample values (reuse the existing sampling loop at lines 284-298)
2. Run `detectDateFormat()` on the samples
3. If a date format is detected, run `normalizeDate()` on ALL values in that column
4. Replace the raw values with normalized ISO dates

**Location:** Between line 237 (`rawData = XLSX.utils.sheet_to_json(...)`) and line 256 (`insertRows(...)`), add a normalization pass.

### Step 3: Handle the XLSX Date object path

For XLSX with `cellDates: true`, Date objects are already handled by `coerceForSQL()` → `.toISOString()`. The normalization pass should skip `Date` objects (they're already ISO-compatible).

For CSV or when dates are strings, the normalization pass converts them before `coerceForSQL()` ever sees them.

## Files to Create/Modify

### Create: `js/core/date-format.ts`
- `detectDateFormat(values: string[]): DateFormat | null`
- `normalizeDate(value: string, format: DateFormat): string | null`
- `normalizeDateColumn(rows: Record<string, unknown>[], col: string): void` — detects + normalizes an entire column

### Modify: `js/ui/loader.ts`
- After `rawData` is produced (line 237), add normalization pass:
  ```ts
  // Normalize date columns
  for (const col of cols) {
    normalizeDateColumn(rawData, col);
  }
  ```

### No changes needed to:
- `sqldb.ts` — `coerceForSQL()` already handles Date objects and ISO strings
- `sql-calcs.ts` — `strftime()` works on ISO dates
- `sql-aggregates.ts` — `julianday()` works on ISO dates

## Edge Cases

- **Mixed formats in one column**: Use majority-wins with format detection
- **Ambiguous 01/02/2023**: Could be Jan 2 or Feb 1 — use `month > 12` disambiguation, default to MM/DD
- **Empty/null values**: Skip during detection, skip during normalization
- **Already ISO dates**: Detect as "already normalized", skip
- **Datetime strings** (e.g., `12/25/2023 14:30`): Strip time portion, normalize date
- **Numeric Excel serial dates** (e.g., `45234`): Skip — these are handled differently and are rare in CSV

## Testing
- Test `detectDateFormat()` with samples of each format
- Test `normalizeDate()` for each format including edge cases (single-digit month/day)
- Test the full pipeline: load CSV with MM/DD/YYYY dates → run report with date extraction → verify correct values
- Test that XLSX Date objects still work (no regression)

## Scope
- **In scope:** MM/DD/YYYY, DD/MM/YYYY, DD MMM YYYY detection and normalization
- **Out of scope:** Timestamps, relative dates, other formats
- **Out of scope:** UI for manual format selection (auto-detect only)
