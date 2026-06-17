/**
 * Calc builder — React components for calculated column mode configuration.
 *
 * Each mode (math, text, compare, date) has its own component that renders
 * the mode-specific form controls using JSX with MUI form components.
 *
 * Ported from Preact to React + MUI.
 */

import type { JSX } from 'react';
import { useState, useEffect } from 'react';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Box from '@mui/material/Box';
import { isISODate, getColumnSamples } from '../../core/date-format';
import { buildColSourceMap } from '../../catalog/column-catalog';
import { Tip } from './tip';
import type { CalcStage } from '../../types';

/** A column option for select dropdowns. */
export interface ColOption {
  value: string;
  label: string;
  selected: boolean;
}

/** Props shared by all calc builder mode components. */
export interface CalcBuilderProps {
  calc: CalcStage;
  i: number;
  cols: string[];
  colOptsFor: (sel: string) => ColOption[];
  onPropChange: (prop: string, val: string) => void;
  onCondChange?: (j: number, prop: string, val: string) => void;
  onTextPartChange?: (j: number, prop: string, val: string) => void;
  onTextAddPart?: () => void;
  onTextRemovePart?: (j: number) => void;
}

/** Compact inline select styling shared across calc builder. */
const compactSelectSx = {
  '& .MuiSelect-select': { py: 0.5, px: 1, fontSize: '0.78rem', minHeight: 'unset' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.15)' },
};

/** Helper: render a column <Select> with column options. */
function ColSelect({ value, sx, onChange, colOpts }: {
  value: string;
  sx?: React.ComponentProps<typeof Select>['sx'];
  onChange: (val: string) => void;
  colOpts: ColOption[];
}) {
  return (
    <FormControl size="small">
      <Select
        value={value}
        onChange={e => onChange(e.target.value as string)}
        sx={{ minWidth: 160, ...compactSelectSx, ...sx }}
        displayEmpty
      >
        <MenuItem value="">{'—'} column {'—'}</MenuItem>
        {colOpts.map(o => (
          <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

// ── Math Builder ───────────────────────────────────────────────────────────────

export function MathBuilder({ calc, colOptsFor, onPropChange }: CalcBuilderProps) {
  const math = calc.math as { strategy?: string; steps?: Array<{ type?: string; value?: string; op?: string }> } | undefined;
  const steps = math?.steps || [];
  const firstStep = steps[0] || {};
  const hasOperators = steps.length > 1;

  const mathOp = hasOperators ? (steps[1]?.op || '+') : '+';
  const leftCol = firstStep.type === 'column' ? (firstStep.value || '') : '';
  const rightCol = hasOperators && steps[1]?.type === 'column' ? (steps[1].value || '') : '';

  const isRollingAvg = (calc as Record<string, unknown>).mathOp === 'ROLLAVG';
  const isPctTotal = (calc as Record<string, unknown>).mathOp === 'PCTTOTAL';
  const windowVal = Math.max(1, parseInt((calc as Record<string, unknown>).window as string || '7', 10) || 7);

  const leftOpts = colOptsFor(leftCol);
  const rightOpts = colOptsFor(rightCol);

  const mathType = isRollingAvg ? 'ROLLAVG' : isPctTotal ? 'PCTTOTAL' : 'ARITH';

  return (
    <>
      <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
        <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Type <Tip text={"Arithmetic — add, subtract, multiply, or divide two columns.\n\nRolling Avg — a moving average over a sliding window of rows (like a 7-day average).\n\n% of Total — each row's value as a percentage of the grand total."} /></Box>
        <FormControl size="small">
          <Select
            value={mathType}
            onChange={e => onPropChange('mathOp', e.target.value as string)}
            sx={{ width: 140, flexShrink: 0, ...compactSelectSx }}
          >
            <MenuItem value="ARITH">Arithmetic</MenuItem>
            <MenuItem value="ROLLAVG">Rolling Avg</MenuItem>
            <MenuItem value="PCTTOTAL">% of Total</MenuItem>
          </Select>
        </FormControl>
      </Box>
      {!isRollingAvg && !isPctTotal && (
        <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}>
          <ColSelect value={leftCol} sx={{ minWidth: 160 }} onChange={v => onPropChange('leftCol', v)} colOpts={leftOpts} />
          <FormControl size="small">
            <Select
              value={mathOp}
              onChange={e => onPropChange('mathOperator', e.target.value as string)}
              sx={{ width: 70, flexShrink: 0, ...compactSelectSx }}
            >
              <MenuItem value="+">+</MenuItem>
              <MenuItem value="-">{'−'}</MenuItem>
              <MenuItem value="*">{'×'}</MenuItem>
              <MenuItem value="/">{'÷'}</MenuItem>
            </Select>
          </FormControl>
          <ColSelect value={rightCol} sx={{ minWidth: 160 }} onChange={v => onPropChange('rightCol', v)} colOpts={rightOpts} />
        </Box>
      )}
      {isRollingAvg && (
        <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}>
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Source</Box>
          <ColSelect value={leftCol} sx={{ minWidth: 190 }} onChange={v => onPropChange('leftCol', v)} colOpts={leftOpts} />
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem', ml: 0.75 }}>Window <Tip text={"How many rows to include in the moving average.\n\nFor example, 7 means the average of the current row and the 6 rows above it — like a 7-day moving average."} /></Box>
          <TextField
            type="number"
            value={windowVal}
            onChange={e => onPropChange('window', e.target.value)}
            size="small"
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
            sx={{ width: 80, flexShrink: 0, '& input': { py: 0.5, px: 1, fontSize: '0.78rem' } }}
          />
        </Box>
      )}
      {isPctTotal && (
        <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}>
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Source <Tip text="The column whose values will be expressed as a percentage of the total. Each row will show what share of the grand total it represents." /></Box>
          <ColSelect value={leftCol} sx={{ minWidth: 190 }} onChange={v => onPropChange('leftCol', v)} colOpts={leftOpts} />
        </Box>
      )}
    </>
  );
}

// ── Text Edit Builder ──────────────────────────────────────────────────────────

const TEXT_OPS = ['combine', 'left', 'right', 'substring'] as const;

export function TextEditBuilder(
  { calc, colOptsFor, onPropChange, onTextPartChange, onTextAddPart, onTextRemovePart }: CalcBuilderProps,
) {
  const text = calc.text as { operation?: string; parts?: Array<{ type?: string; value?: string }>; source?: { type?: string; value?: string }; count?: number; start?: number; length?: number } | undefined;
  const op = text?.operation || 'combine';

  const handleOpChange = (newOp: string) => {
    onPropChange('textOperation', newOp);
  };

  /** Shared tab-row radio selector for text operations. */
  const toggleBtnSx = {
    py: 0.25, px: 1, fontSize: '0.75rem', textTransform: 'none' as const,
    color: 'rgba(255,255,255,0.7)',
    '&.Mui-selected': { color: '#fff', bgcolor: 'rgba(255,255,255,0.12)' },
  };
  const textOpTabs = (
    <ToggleButtonGroup
      value={op}
      exclusive
      onChange={(_e, val) => { if (val) handleOpChange(val); }}
      size="small"
      className="tab-row"
      sx={{ mt: 1, '& .MuiToggleButton-root': toggleBtnSx }}
    >
      {TEXT_OPS.map(o => (
        <ToggleButton key={o} value={o}>
          {o.charAt(0).toUpperCase() + o.slice(1)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );

  // ── Combine builder ──────────────────────────────────────────────────────

  if (op === 'combine') {
    const parts = text?.parts || [];

    return (
      <>
        {textOpTabs}
        {parts.map((part, j) => (
          <Box className="pl-key-pair" key={j} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: j === 0 ? 1 : 0.5 }}>
            <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>{j === 0 ? 'Parts' : ''}</Box>
            <FormControl size="small">
              <Select
                value={part.type || 'column'}
                onChange={e => onTextPartChange?.(j, 'type', e.target.value as string)}
                sx={{ width: 70, flexShrink: 0, ...compactSelectSx }}
              >
                <MenuItem value="column">Column</MenuItem>
                <MenuItem value="text">Text</MenuItem>
                <MenuItem value="number">Number</MenuItem>
              </Select>
            </FormControl>
            {part.type === 'column' ? (
              <ColSelect value={part.value || ''} sx={{ minWidth: 160 }}
                onChange={v => onTextPartChange?.(j, 'value', v)}
                colOpts={colOptsFor(part.value || '')} />
            ) : (
              <TextField
                value={part.value || ''}
                placeholder={part.type === 'number' ? 'number' : 'text'}
                onChange={e => onTextPartChange?.(j, 'value', e.target.value)}
                size="small"
                sx={{ minWidth: 160, '& input': { py: 0.5, px: 1, fontSize: '0.78rem' } }}
              />
            )}
            <Button
              variant="outlined"
              color="error"
              size="small"
              onClick={() => onTextRemovePart?.(j)}
              disabled={parts.length <= 1}
              sx={{ flexShrink: 0, py: 0, px: 0.75, fontSize: '0.7rem', minWidth: 'unset' }}
            >{'✕'}</Button>
          </Box>
        ))}
        <Button
          variant="outlined"
          size="small"
          onClick={() => onTextAddPart?.()}
          sx={{ mt: 0.5, fontSize: '0.72rem', textTransform: 'none' }}
        >
          + Add Part
        </Button>
        <Tip text={"Combine joins parts together as a single text value. Each part can be a column reference, static text, or a number. Parts are separated by the pipe character (||) in SQL — add a text part like ', ' to insert a separator between column values."} />
      </>
    );
  }

  // ── Left / Right builder ─────────────────────────────────────────────────

  if (op === 'left' || op === 'right') {
    const src = text?.source;
    const srcCol = src?.type === 'column' ? (src.value || '') : '';
    const count = text?.count || 1;

    return (
      <>
        {textOpTabs}
        <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Source</Box>
          <ColSelect value={srcCol} sx={{ minWidth: 190 }} onChange={v => onPropChange('textSource', v)} colOpts={colOptsFor(srcCol)} />
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem', ml: 0.75 }}>Count</Box>
          <TextField
            type="number"
            value={count}
            onChange={e => onPropChange('textCount', e.target.value)}
            size="small"
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
            sx={{ width: 80, flexShrink: 0, '& input': { py: 0.5, px: 1, fontSize: '0.78rem' } }}
          />
        </Box>
      </>
    );
  }

  // ── Substring builder ────────────────────────────────────────────────────

  if (op === 'substring') {
    const src = text?.source;
    const srcCol = src?.type === 'column' ? (src.value || '') : '';
    const start = text?.start || 1;
    const length = text?.length || 1;

    return (
      <>
        {textOpTabs}
        <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Source</Box>
          <ColSelect value={srcCol} sx={{ minWidth: 190 }} onChange={v => onPropChange('textSource', v)} colOpts={colOptsFor(srcCol)} />
        </Box>
        <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Start</Box>
          <TextField
            type="number"
            value={start}
            onChange={e => onPropChange('textStart', e.target.value)}
            size="small"
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
            sx={{ width: 80, flexShrink: 0, '& input': { py: 0.5, px: 1, fontSize: '0.78rem' } }}
          />
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem', ml: 0.75 }}>Length</Box>
          <TextField
            type="number"
            value={length}
            onChange={e => onPropChange('textLength', e.target.value)}
            size="small"
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
            sx={{ width: 80, flexShrink: 0, '& input': { py: 0.5, px: 1, fontSize: '0.78rem' } }}
          />
        </Box>
      </>
    );
  }

  return <></>;
}

// ── Compare Builder ────────────────────────────────────────────────────────────

const COND_OPS = ['=', '!=', '>', '>=', '<', '<='];

export function CompareBuilder({ calc, colOptsFor, onPropChange, onCondChange }: CalcBuilderProps) {
  const compare = calc.compare as { compareMode?: string; conditions?: Array<{ col?: string; op?: string; val?: string }>; trueValue?: { type?: string; value?: string }; falseValue?: { type?: string; value?: string } } | undefined;
  const glue = compare?.compareMode || 'AND';
  const conditions = compare?.conditions || [];
  const trueVal = compare?.trueValue;
  const falseVal = compare?.falseValue;

  const handleCondChange = (j: number, prop: string, val: string) => {
    if (onCondChange) onCondChange(j, prop, val);
  };

  return (
    <>
      <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
        <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Match <Tip text={"ALL — every condition must be true (like AND in Excel).\n\nANY — at least one condition must be true (like OR in Excel)."} /></Box>
        <FormControl size="small">
          <Select
            value={glue}
            onChange={e => onPropChange('compareMode', e.target.value as string)}
            sx={{ width: 80, flexShrink: 0, ...compactSelectSx }}
          >
            <MenuItem value="AND">ALL</MenuItem>
            <MenuItem value="OR">ANY</MenuItem>
          </Select>
        </FormControl>
        <Box component="span" sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>of these conditions:</Box>
      </Box>
      {conditions.map((cond, j) => (
        <Box className="pl-key-pair" key={j} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: j === 0 ? 0.75 : 0.5 }}>
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>{j === 0 ? 'Where' : glue}</Box>
          <ColSelect value={cond.col || ''} sx={{ minWidth: 140 }} onChange={v => handleCondChange(j, 'col', v)} colOpts={colOptsFor(cond.col || '')} />
          <FormControl size="small">
            <Select
              value={cond.op || '='}
              onChange={e => handleCondChange(j, 'op', e.target.value as string)}
              sx={{ width: 62, flexShrink: 0, ...compactSelectSx }}
            >
              {COND_OPS.map(o => (
                <MenuItem key={o} value={o}>{o}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            value={cond.val || ''}
            placeholder="value"
            onChange={e => handleCondChange(j, 'val', e.target.value)}
            size="small"
            sx={{ minWidth: 100, '& input': { py: 0.5, px: 1, fontSize: '0.78rem' } }}
          />
        </Box>
      ))}
      <Box sx={{ mt: 0.75, fontSize: '0.72rem', color: 'text.secondary' }}>
        Returns: {trueVal?.type === 'text' ? `"${trueVal.value || ''}"` : trueVal?.value || '1'} if match, {falseVal?.type === 'text' ? `"${falseVal.value || ''}"` : falseVal?.value || '0'} if not
      </Box>
    </>
  );
}

// ── Date Builder ───────────────────────────────────────────────────────────────

const FMT_OPTS: Array<[string, string]> = [['D','D'],['DD','DD'],['M','M'],['MM','MM'],['MMM','MMM'],['YY','YY'],['YYYY','YYYY']];

export function DateBuilder({ calc, i: _i, colOptsFor, onPropChange }: CalcBuilderProps) {
  const date = calc.date as { operation?: string; source?: { type?: string; value?: string }; part?: string; output?: string; inputFormat?: { first?: string; second?: string; third?: string } } | undefined;
  const src = date?.source;
  const srcCol = src?.type === 'column' ? (src.value || '') : '';
  const part = date?.part || 'year';
  const output = date?.output || 'text';
  const fmt = date?.inputFormat || {};
  const fmtFirst = fmt.first || 'MM';
  const fmtSecond = fmt.second || 'DD';
  const fmtThird = fmt.third || 'YYYY';

  // Subscribe to store for ISO detection (requires reading column samples)
  const [isoDetected, setIsoDetected] = useState(false);
  useEffect(() => {
    if (!srcCol) { setIsoDetected(false); return; }
    const colMap = buildColSourceMap();
    const entry = colMap.get(srcCol);
    if (entry && entry.kind !== 'calc') {
      const samples = getColumnSamples(entry.tid, entry.col);
      setIsoDetected(isISODate(samples));
    } else {
      setIsoDetected(false);
    }
  }, [srcCol]);

  const textOnly = part === 'year' || part === 'week';

  const srcOpts = colOptsFor(srcCol);

  return (
    <>
      <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
        <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Source</Box>
        <ColSelect value={srcCol} sx={{ minWidth: 190 }} onChange={v => onPropChange('dateSource', v)} colOpts={srcOpts} />
      </Box>
      {isoDetected ? (
        <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Input format</Box>
          <Box component="span" sx={{ fontSize: '0.72rem', color: 'success.main' }}>ISO (auto-detected)</Box>
        </Box>
      ) : (
        <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Input format <Tip text={'D = day (1-9)\nDD = day (01-09)\nM = month (1-9)\nMM = month (01-09)\nMMM = month name (Jan, Feb, ...)\nYY = 2-digit year (23)\nYYYY = 4-digit year (2023)\n\nPick the order your dates use.\nExample: 12/25/2023 → MM/DD/YYYY\nExample: 25-Dec-2023 → DD/MMM/YYYY'} /></Box>
          <Box sx={{ display: 'flex', gap: 0.25, alignItems: 'center' }}>
            <FormControl size="small">
              <Select
                value={fmtFirst}
                onChange={e => onPropChange('dateFmtFirst', e.target.value as string)}
                sx={{ width: 65, ...compactSelectSx }}
              >
                {FMT_OPTS.map(([val, label]) => <MenuItem key={val} value={val}>{label}</MenuItem>)}
              </Select>
            </FormControl>
            <Box component="span" sx={{ color: 'text.secondary' }}>/</Box>
            <FormControl size="small">
              <Select
                value={fmtSecond}
                onChange={e => onPropChange('dateFmtSecond', e.target.value as string)}
                sx={{ width: 65, ...compactSelectSx }}
              >
                {FMT_OPTS.map(([val, label]) => <MenuItem key={val} value={val}>{label}</MenuItem>)}
              </Select>
            </FormControl>
            <Box component="span" sx={{ color: 'text.secondary' }}>/</Box>
            <FormControl size="small">
              <Select
                value={fmtThird}
                onChange={e => onPropChange('dateFmtThird', e.target.value as string)}
                sx={{ width: 65, ...compactSelectSx }}
              >
                {FMT_OPTS.map(([val, label]) => <MenuItem key={val} value={val}>{label}</MenuItem>)}
              </Select>
            </FormControl>
          </Box>
        </Box>
      )}
      <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Extract</Box>
        <FormControl size="small">
          <Select
            value={part}
            onChange={e => onPropChange('datePart', e.target.value as string)}
            sx={{ width: 140, flexShrink: 0, ...compactSelectSx }}
          >
            <MenuItem value="year">Year</MenuItem>
            <MenuItem value="month">Month</MenuItem>
            <MenuItem value="day">Day</MenuItem>
            <MenuItem value="dow">Day of Week</MenuItem>
            <MenuItem value="week">Week</MenuItem>
            <MenuItem value="quarter">Quarter</MenuItem>
            <MenuItem value="julian">Julian Date</MenuItem>
          </Select>
        </FormControl>
      </Box>
      <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Format</Box>
        <ToggleButtonGroup
          value={output}
          exclusive
          onChange={(_e, val) => { if (val) onPropChange('dateOutput', val); }}
          size="small"
          className="tab-row"
          sx={{
            '& .MuiToggleButton-root': {
              py: 0.25, px: 1, fontSize: '0.75rem', textTransform: 'none',
              color: 'rgba(255,255,255,0.7)',
              '&.Mui-selected': { color: '#fff', bgcolor: 'rgba(255,255,255,0.12)' },
              '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)' },
            },
          }}
        >
          <ToggleButton value="number">Number</ToggleButton>
          <ToggleButton value="short" disabled={textOnly}>Short</ToggleButton>
          <ToggleButton value="text" disabled={textOnly}>Full</ToggleButton>
        </ToggleButtonGroup>
      </Box>
    </>
  );
}

// ── Component Registry ─────────────────────────────────────────────────────────

export const calcModeComponents: Record<string, (props: CalcBuilderProps) => JSX.Element> = {
  math: MathBuilder,
  text: TextEditBuilder,
  compare: CompareBuilder,
  date: DateBuilder,
};
