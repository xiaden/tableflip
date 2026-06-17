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
  onMathStepChange?: (stepIdx: number, prop: string, val: string) => void;
  onMathAddStep?: () => void;
  onMathRemoveStep?: (stepIdx: number) => void;
}

/** Available step types for math mode step chain. */
const MATH_STEP_TYPES = ['column', 'number', 'text'] as const;

/** Available math operators for step chain. */
const MATH_OPS = [
  { value: '+', label: '+' },
  { value: '-', label: '\u2212' },
  { value: '*', label: '\u00D7' },
  { value: '/', label: '\u00F7' },
  { value: '%', label: '%' },
] as const;

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
        sx={{ minWidth: 160, ...sx }}
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

/**
 * Render a single step row for the math step chain.
 * Step 0 has no operator selector. Operator selector only appears for step > 0.
 * Remove button only appears when more than 1 step exists.
 */
function MathStepRow({ step, idx, colOptsFor, onStepChange, onRemove, canRemove }: {
  step: { type?: string; value?: string; op?: string };
  idx: number;
  colOptsFor: (sel: string) => ColOption[];
  onStepChange: (prop: string, val: string) => void;
  onRemove?: () => void;
  canRemove: boolean;
}) {
  const stepType = step.type || 'column';
  const stepVal = step.value || '';

  return (
    <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: idx === 0 ? 0.75 : 0.5 }}>
      <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem', minWidth: idx === 0 ? 40 : undefined }}>
        {idx === 0 ? 'Steps' : ''}
      </Box>
      <FormControl size="small">
        <Select
          value={stepType}
          onChange={e => onStepChange('type', e.target.value as string)}
          sx={{ width: 80, flexShrink: 0 }}
        >
          {MATH_STEP_TYPES.map(t => (
            <MenuItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</MenuItem>
          ))}
        </Select>
      </FormControl>
      {stepType === 'column' ? (
        <ColSelect value={stepVal} sx={{ minWidth: 150 }} onChange={v => onStepChange('value', v)} colOpts={colOptsFor(stepVal)} />
      ) : (
        <TextField
          value={stepVal}
          type={stepType === 'number' ? 'number' : 'text'}
          placeholder={stepType === 'number' ? 'number' : 'text'}
          onChange={e => onStepChange('value', e.target.value)}
          size="small"
          sx={{ minWidth: 150 }}
        />
      )}
      {idx > 0 && (
        <FormControl size="small">
          <Select
            value={step.op || '+'}
            onChange={e => onStepChange('op', e.target.value as string)}
            sx={{ width: 62, flexShrink: 0 }}
          >
            {MATH_OPS.map(o => (
              <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
      {canRemove && onRemove && (
        <Button
          variant="outlined"
          color="error"
          size="small"
          onClick={onRemove}
          disabled={!canRemove}
          sx={{ flexShrink: 0, py: 0, px: 0.75, fontSize: '0.7rem', minWidth: 'unset' }}
        >{'✕'}</Button>
      )}
    </Box>
  );
}

export function MathBuilder({ calc, colOptsFor, onPropChange, onMathStepChange, onMathAddStep, onMathRemoveStep }: CalcBuilderProps) {
  const math = calc.math as { strategy?: string; steps?: Array<{ type?: string; value?: string; op?: string }> } | undefined;
  const steps = math?.steps || [];

  const isRollingAvg = (calc as Record<string, unknown>).mathOp === 'ROLLAVG';
  const isPctTotal = (calc as Record<string, unknown>).mathOp === 'PCTTOTAL';
  const isArith = !isRollingAvg && !isPctTotal;
  const windowVal = Math.max(1, parseInt((calc as Record<string, unknown>).window as string || '7', 10) || 7);

  const mathType = isRollingAvg ? 'ROLLAVG' : isPctTotal ? 'PCTTOTAL' : 'ARITH';

  /** Render a single step as the source for ROLLAVG/PCTTOTAL modes. */
  const renderSourceStep = () => {
    const step = steps[0] || {};
    const stepType = step.type || 'column';
    const stepVal = step.value || '';
    const doChange = onMathStepChange ? (p: string, v: string) => onMathStepChange(0, p, v) : () => {};

    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
        <FormControl size="small">
          <Select
            value={stepType}
            onChange={e => doChange('type', e.target.value as string)}
            sx={{ width: 80, flexShrink: 0 }}
          >
            {MATH_STEP_TYPES.map(t => (
              <MenuItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</MenuItem>
            ))}
          </Select>
        </FormControl>
        {stepType === 'column' ? (
          <ColSelect value={stepVal} sx={{ minWidth: 150 }} onChange={v => doChange('value', v)} colOpts={colOptsFor(stepVal)} />
        ) : (
          <TextField
            value={stepVal}
            type={stepType === 'number' ? 'number' : 'text'}
            placeholder={stepType === 'number' ? 'number' : 'text'}
            onChange={e => doChange('value', e.target.value)}
            size="small"
            sx={{ minWidth: 150 }}
          />
        )}
      </Box>
    );
  };

  return (
    <>
      <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
        <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Type <Tip text={"Arithmetic — add, subtract, multiply, or divide columns and numbers.\n\nRolling Avg — a moving average over a sliding window of rows (like a 7-day average).\n\n% of Total — each row's value as a percentage of the grand total."} /></Box>
        <FormControl size="small">
          <Select
            value={mathType}
            onChange={e => onPropChange('mathOp', e.target.value as string)}
            sx={{ width: 140, flexShrink: 0 }}
          >
            <MenuItem value="ARITH">Arithmetic</MenuItem>
            <MenuItem value="ROLLAVG">Rolling Avg</MenuItem>
            <MenuItem value="PCTTOTAL">% of Total</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {isArith && (
        <>
          {steps.map((step, idx) => (
            <MathStepRow
              key={idx}
              step={step}
              idx={idx}
              colOptsFor={colOptsFor}
              onStepChange={(prop, val) => onMathStepChange?.(idx, prop, val)}
              onRemove={() => onMathRemoveStep?.(idx)}
              canRemove={steps.length > 1}
            />
          ))}
          <Button
            variant="outlined"
            size="small"
            onClick={() => onMathAddStep?.()}
            sx={{ mt: 0.5, fontSize: '0.72rem', textTransform: 'none' }}
          >
            + Add Step
          </Button>
        </>
      )}

      {isRollingAvg && (
        <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}>
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Source</Box>
          {renderSourceStep()}
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem', ml: 0.75 }}>Window <Tip text={"How many rows to include in the moving average.\n\nFor example, 7 means the average of the current row and the 6 rows above it — like a 7-day moving average."} /></Box>
          <TextField
            type="number"
            value={windowVal}
            onChange={e => onPropChange('window', e.target.value)}
            size="small"
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
            sx={{ width: 80, flexShrink: 0 }}
          />
        </Box>
      )}

      {isPctTotal && (
        <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}>
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Source <Tip text="The column whose values will be expressed as a percentage of the total. Each row will show what share of the grand total it represents." /></Box>
          {renderSourceStep()}
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

  const textOpTabs = (
    <ToggleButtonGroup
      value={op}
      exclusive
      onChange={(_e, val) => { if (val) handleOpChange(val); }}
      size="small"
      className="tab-row"
      sx={{ mt: 1 }}
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
                sx={{ width: 70, flexShrink: 0 }}
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
                sx={{ minWidth: 160 }}
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
            sx={{ width: 80, flexShrink: 0 }}
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
            sx={{ width: 80, flexShrink: 0 }}
          />
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem', ml: 0.75 }}>Length</Box>
          <TextField
            type="number"
            value={length}
            onChange={e => onPropChange('textLength', e.target.value)}
            size="small"
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
            sx={{ width: 80, flexShrink: 0 }}
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
            sx={{ width: 80, flexShrink: 0 }}
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
              sx={{ width: 62, flexShrink: 0 }}
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
            sx={{ minWidth: 100 }}
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
const DATE_UNITS = ['days', 'weeks', 'months', 'years'] as const;

export function DateBuilder({ calc, i: _i, colOptsFor, onPropChange }: CalcBuilderProps) {
  const date = calc.date as {
    operation?: string;
    source?: { type?: string; value?: string };
    source2?: { type?: string; value?: string };
    part?: string;
    output?: string;
    inputFormat?: { first?: string; second?: string; third?: string };
    unit?: string;
    operand?: { type?: string; value?: string };
  } | undefined;

  const op = date?.operation || 'extract';
  const src = date?.source;
  const src2 = date?.source2;
  const srcCol = src?.type === 'column' ? (src.value || '') : '';
  const src2Col = src2?.type === 'column' ? (src2.value || '') : '';
  const part = date?.part || 'year';
  const output = date?.output || 'text';
  const fmt = date?.inputFormat || {};
  const fmtFirst = fmt.first || 'MM';
  const fmt_second = fmt.second || 'DD';
  const fmt_third = fmt.third || 'YYYY';
  const unit = date?.unit || 'days';
  const operand = date?.operand;
  const operandType = operand?.type || 'number';
  const operandValue = operand?.value || '';

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
  const src2Opts = colOptsFor(src2Col);

  const opTabs = (
    <ToggleButtonGroup
      value={op}
      exclusive
      onChange={(_e, val) => { if (val) onPropChange('dateOperation', val); }}
      size="small"
      className="tab-row"
      sx={{ mt: 1 }}
    >
      <ToggleButton value="extract">Extract</ToggleButton>
      <ToggleButton value="duration">Duration</ToggleButton>
      <ToggleButton value="add">Add</ToggleButton>
      <ToggleButton value="subtract">Subtract</ToggleButton>
    </ToggleButtonGroup>
  );

  const inputFormatSection = isoDetected ? (
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
            sx={{ width: 65 }}
          >
            {FMT_OPTS.map(([val, label]) => <MenuItem key={val} value={val}>{label}</MenuItem>)}
          </Select>
        </FormControl>
        <Box component="span" sx={{ color: 'text.secondary' }}>/</Box>
        <FormControl size="small">
          <Select
            value={fmt_second}
            onChange={e => onPropChange('dateFmtSecond', e.target.value as string)}
            sx={{ width: 65 }}
          >
            {FMT_OPTS.map(([val, label]) => <MenuItem key={val} value={val}>{label}</MenuItem>)}
          </Select>
        </FormControl>
        <Box component="span" sx={{ color: 'text.secondary' }}>/</Box>
        <FormControl size="small">
          <Select
            value={fmt_third}
            onChange={e => onPropChange('dateFmtThird', e.target.value as string)}
            sx={{ width: 65 }}
          >
            {FMT_OPTS.map(([val, label]) => <MenuItem key={val} value={val}>{label}</MenuItem>)}
          </Select>
        </FormControl>
      </Box>
    </Box>
  );

  // ── Extract builder ──────────────────────────────────────────────────────

  if (op === 'extract') {
    return (
      <>
        {opTabs}
        <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Source</Box>
          <ColSelect value={srcCol} sx={{ minWidth: 190 }} onChange={v => onPropChange('dateSource', v)} colOpts={srcOpts} />
        </Box>
        {inputFormatSection}
        <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Extract</Box>
          <FormControl size="small">
            <Select
              value={part}
              onChange={e => onPropChange('datePart', e.target.value as string)}
              sx={{ width: 140, flexShrink: 0 }}
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
          >
            <ToggleButton value="number">Number</ToggleButton>
            <ToggleButton value="short" disabled={textOnly}>Short</ToggleButton>
            <ToggleButton value="text" disabled={textOnly}>Full</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </>
    );
  }

  // ── Duration builder ─────────────────────────────────────────────────────

  if (op === 'duration') {
    return (
      <>
        {opTabs}
        <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Start date</Box>
          <ColSelect value={srcCol} sx={{ minWidth: 190 }} onChange={v => onPropChange('dateSource', v)} colOpts={srcOpts} />
        </Box>
        {inputFormatSection}
        <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>End date</Box>
          <ColSelect value={src2Col} sx={{ minWidth: 190 }} onChange={v => onPropChange('dateSource2', v)} colOpts={src2Opts} />
        </Box>
        <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Unit</Box>
          <FormControl size="small">
            <Select
              value={unit}
              onChange={e => onPropChange('dateUnit', e.target.value as string)}
              sx={{ width: 100, flexShrink: 0 }}
            >
              {DATE_UNITS.map(u => (
                <MenuItem key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        <Tip text={"Calculates the difference between two dates in the selected unit.\n\n• Days: Total days between dates\n• Weeks: Total weeks (rounded down)\n• Months: Year and month difference\n• Years: Year difference"} />
      </>
    );
  }

  // ── Add / Subtract builder ───────────────────────────────────────────────

  return (
    <>
      {opTabs}
      <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
        <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Source date</Box>
        <ColSelect value={srcCol} sx={{ minWidth: 190 }} onChange={v => onPropChange('dateSource', v)} colOpts={srcOpts} />
      </Box>
      {inputFormatSection}
      <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>{op === 'add' ? 'Add' : 'Subtract'}</Box>
        <FormControl size="small">
          <Select
            value={operandType}
            onChange={e => onPropChange('dateOperandType', e.target.value as string)}
            sx={{ width: 80, flexShrink: 0 }}
          >
            <MenuItem value="number">Number</MenuItem>
            <MenuItem value="column">Column</MenuItem>
          </Select>
        </FormControl>
        {operandType === 'column' ? (
          <ColSelect value={operandValue} sx={{ minWidth: 150 }} onChange={v => onPropChange('dateOperandValue', v)} colOpts={colOptsFor(operandValue)} />
        ) : (
          <TextField
            value={operandValue}
            type="number"
            placeholder="number"
            onChange={e => onPropChange('dateOperandValue', e.target.value)}
            size="small"
            sx={{ minWidth: 100 }}
          />
        )}
      </Box>
      <Box className="pl-key-pair" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <Box className="pl-key-pair-label" sx={{ fontSize: '0.78rem' }}>Unit</Box>
        <FormControl size="small">
          <Select
            value={unit}
            onChange={e => onPropChange('dateUnit', e.target.value as string)}
            sx={{ width: 100, flexShrink: 0 }}
          >
            {DATE_UNITS.map(u => (
              <MenuItem key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
      <Tip text={op === 'add'
        ? "Adds the specified amount to the source date.\n\n• Days: Add N days\n• Weeks: Add N weeks (7×N days)\n• Months: Add N months\n• Years: Add N years"
        : "Subtracts the specified amount from the source date.\n\n• Days: Subtract N days\n• Weeks: Subtract N weeks (7×N days)\n• Months: Subtract N months\n• Years: Subtract N years"} />
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
