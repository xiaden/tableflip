/**
 * Calc builder — Preact components for calculated column mode configuration.
 *
 * Each mode (math, text, compare, date) has its own component that renders
 * the mode-specific form controls using JSX with direct Preact event handlers.
 *
 * Ported from string-returning HTML builders to proper Preact components.
 */

import type { JSX } from 'preact';
import { useState, useEffect } from 'preact/hooks';
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
}

/** Helper: render a column <select> with column options. */
function ColSelect({ value, style, onChange, colOpts }: {
  value: string;
  style?: string;
  onChange: (val: string) => void;
  colOpts: ColOption[];
}) {
  return (
    <select style={style} value={value} onChange={e => onChange((e.target as HTMLSelectElement).value)}>
      <option value="">{'—'} column {'—'}</option>
      {colOpts.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// ── Math Builder ───────────────────────────────────────────────────────────────

export function MathBuilder({ calc, i, cols, colOptsFor, onPropChange }: CalcBuilderProps) {
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

  return (
    <>
      <div class="pl-key-pair" style="margin-top:8px">
        <span class="pl-key-pair-label">Type <Tip text={"Arithmetic — add, subtract, multiply, or divide two columns.\n\nRolling Avg — a moving average over a sliding window of rows (like a 7-day average).\n\n% of Total — each row's value as a percentage of the grand total."} /></span>
        <select style="width:140px;flex-shrink:0" value={isRollingAvg ? 'ROLLAVG' : isPctTotal ? 'PCTTOTAL' : 'ARITH'} onChange={e => onPropChange('mathOp', (e.target as HTMLSelectElement).value)}>
          <option value="ARITH">Arithmetic</option>
          <option value="ROLLAVG">Rolling Avg</option>
          <option value="PCTTOTAL">% of Total</option>
        </select>
      </div>
      {!isRollingAvg && !isPctTotal && (
        <div class="pl-key-pair" style="margin-top:6px">
          <ColSelect value={leftCol} style="min-width:160px" onChange={v => onPropChange('leftCol', v)} colOpts={leftOpts} />
          <select style="width:70px;flex-shrink:0" value={mathOp} onChange={e => onPropChange('mathOperator', (e.target as HTMLSelectElement).value)}>
            <option value="+">+</option>
            <option value="-">{'−'}</option>
            <option value="*">{'×'}</option>
            <option value="/">{'÷'}</option>
          </select>
          <ColSelect value={rightCol} style="min-width:160px" onChange={v => onPropChange('rightCol', v)} colOpts={rightOpts} />
        </div>
      )}
      {isRollingAvg && (
        <div class="pl-key-pair" style="margin-top:6px">
          <span class="pl-key-pair-label">Source</span>
          <ColSelect value={leftCol} style="min-width:190px" onChange={v => onPropChange('leftCol', v)} colOpts={leftOpts} />
          <span class="pl-key-pair-label" style="margin-left:6px">Window <Tip text={"How many rows to include in the moving average.\n\nFor example, 7 means the average of the current row and the 6 rows above it — like a 7-day moving average."} /></span>
          <input type="number" min="1" step="1" value={windowVal} style="width:80px;flex-shrink:0"
            onChange={e => onPropChange('window', (e.target as HTMLInputElement).value)} />
        </div>
      )}
      {isPctTotal && (
        <div class="pl-key-pair" style="margin-top:6px">
          <span class="pl-key-pair-label">Source <Tip text="The column whose values will be expressed as a percentage of the total. Each row will show what share of the grand total it represents." /></span>
          <ColSelect value={leftCol} style="min-width:190px" onChange={v => onPropChange('leftCol', v)} colOpts={leftOpts} />
        </div>
      )}
    </>
  );
}

// ── Text Edit Builder ──────────────────────────────────────────────────────────

export function TextEditBuilder({ calc, i, cols, colOptsFor, onPropChange }: CalcBuilderProps) {
  const text = calc.text as { operation?: string; parts?: Array<{ type?: string; value?: string }>; source?: { type?: string; value?: string }; count?: number; start?: number; length?: number } | undefined;
  const op = text?.operation || 'combine';

  if (op === 'combine') {
    const parts = text?.parts || [];
    return (
      <>
        <div style="margin-top:8px;font-size:0.76rem;color:var(--muted)">Combine parts: {parts.length} part(s)</div>
        <div style="margin-top:4px;font-size:0.7rem;color:var(--muted)">Edit via report setup file for complex combinations.</div>
      </>
    );
  }

  if (op === 'left' || op === 'right') {
    const src = text?.source;
    const srcCol = src?.type === 'column' ? (src.value || '') : '';
    const count = text?.count || 1;
    return (
      <div class="pl-key-pair" style="margin-top:8px">
        <span class="pl-key-pair-label">Source</span>
        <ColSelect value={srcCol} style="min-width:190px" onChange={v => onPropChange('textSource', v)} colOpts={colOptsFor(srcCol)} />
        <span class="pl-key-pair-label" style="margin-left:6px">Count</span>
        <input type="number" min="1" step="1" value={count} style="width:80px;flex-shrink:0"
          onChange={e => onPropChange('textCount', (e.target as HTMLInputElement).value)} />
      </div>
    );
  }

  if (op === 'substring') {
    const src = text?.source;
    const srcCol = src?.type === 'column' ? (src.value || '') : '';
    const start = text?.start || 1;
    const length = text?.length || 1;
    return (
      <>
        <div class="pl-key-pair" style="margin-top:8px">
          <span class="pl-key-pair-label">Source</span>
          <ColSelect value={srcCol} style="min-width:190px" onChange={v => onPropChange('textSource', v)} colOpts={colOptsFor(srcCol)} />
        </div>
        <div class="pl-key-pair" style="margin-top:4px">
          <span class="pl-key-pair-label">Start</span>
          <input type="number" min="1" step="1" value={start} style="width:80px;flex-shrink:0"
            onChange={e => onPropChange('textStart', (e.target as HTMLInputElement).value)} />
          <span class="pl-key-pair-label" style="margin-left:6px">Length</span>
          <input type="number" min="1" step="1" value={length} style="width:80px;flex-shrink:0"
            onChange={e => onPropChange('textLength', (e.target as HTMLInputElement).value)} />
        </div>
      </>
    );
  }

  return <></>;
}

// ── Compare Builder ────────────────────────────────────────────────────────────

const COND_OPS = ['=', '!=', '>', '>=', '<', '<='];

export function CompareBuilder({ calc, i, cols, colOptsFor, onPropChange, onCondChange }: CalcBuilderProps) {
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
      <div class="pl-key-pair" style="margin-top:8px">
        <span class="pl-key-pair-label">Match <Tip text={"ALL — every condition must be true (like AND in Excel).\n\nANY — at least one condition must be true (like OR in Excel)."} /></span>
        <select style="width:80px;flex-shrink:0" value={glue} onChange={e => onPropChange('compareMode', (e.target as HTMLSelectElement).value)}>
          <option value="AND">ALL</option>
          <option value="OR">ANY</option>
        </select>
        <span style="font-size:0.72rem;color:var(--muted)">of these conditions:</span>
      </div>
      {conditions.map((cond, j) => (
        <div class="pl-key-pair" style={`margin-top:${j === 0 ? '6px' : '4px'}`} key={j}>
          <span class="pl-key-pair-label">{j === 0 ? 'Where' : glue}</span>
          <ColSelect value={cond.col || ''} style="min-width:140px" onChange={v => handleCondChange(j, 'col', v)} colOpts={colOptsFor(cond.col || '')} />
          <select style="width:62px;flex-shrink:0" value={cond.op || '='} onChange={e => handleCondChange(j, 'op', (e.target as HTMLSelectElement).value)}>
            {COND_OPS.map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <input type="text" placeholder="value" value={cond.val || ''} style="min-width:100px"
            onChange={e => handleCondChange(j, 'val', (e.target as HTMLInputElement).value)} />
        </div>
      ))}
      <div style="margin-top:6px;font-size:0.72rem;color:var(--muted)">
        Returns: {trueVal?.type === 'text' ? `"${trueVal.value || ''}"` : trueVal?.value || '1'} if match, {falseVal?.type === 'text' ? `"${falseVal.value || ''}"` : falseVal?.value || '0'} if not
      </div>
    </>
  );
}

// ── Date Builder ───────────────────────────────────────────────────────────────

const FMT_OPTS: Array<[string, string]> = [['D','D'],['DD','DD'],['M','M'],['MM','MM'],['MMM','MMM'],['YY','YY'],['YYYY','YYYY']];

export function DateBuilder({ calc, i, cols, colOptsFor, onPropChange }: CalcBuilderProps) {
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
      <div class="pl-key-pair" style="margin-top:8px">
        <span class="pl-key-pair-label">Source</span>
        <ColSelect value={srcCol} style="min-width:190px" onChange={v => onPropChange('dateSource', v)} colOpts={srcOpts} />
      </div>
      {isoDetected ? (
        <div class="pl-key-pair" style="margin-top:4px">
          <span class="pl-key-pair-label">Input format</span>
          <span style="font-size:0.72rem;color:var(--green)">ISO (auto-detected)</span>
        </div>
      ) : (
        <div class="pl-key-pair" style="margin-top:4px">
          <span class="pl-key-pair-label">Input format <span class="tip" data-tip={'D = day (1-9)\nDD = day (01-09)\nM = month (1-9)\nMM = month (01-09)\nMMM = month name (Jan, Feb, ...)\nYY = 2-digit year (23)\nYYYY = 4-digit year (2023)\n\nPick the order your dates use.\nExample: 12/25/2023 → MM/DD/YYYY\nExample: 25-Dec-2023 → DD/MMM/YYYY'}>?</span></span>
          <div style="display:flex;gap:2px;align-items:center">
            <select style="width:65px" value={fmtFirst} onChange={e => onPropChange('dateFmtFirst', (e.target as HTMLSelectElement).value)}>
              {FMT_OPTS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
            <span style="color:var(--muted)">/</span>
            <select style="width:65px" value={fmtSecond} onChange={e => onPropChange('dateFmtSecond', (e.target as HTMLSelectElement).value)}>
              {FMT_OPTS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
            <span style="color:var(--muted)">/</span>
            <select style="width:65px" value={fmtThird} onChange={e => onPropChange('dateFmtThird', (e.target as HTMLSelectElement).value)}>
              {FMT_OPTS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          </div>
        </div>
      )}
      <div class="pl-key-pair" style="margin-top:4px">
        <span class="pl-key-pair-label">Extract</span>
        <select style="width:140px;flex-shrink:0" value={part} onChange={e => onPropChange('datePart', (e.target as HTMLSelectElement).value)}>
          <option value="year">Year</option>
          <option value="month">Month</option>
          <option value="day">Day</option>
          <option value="dow">Day of Week</option>
          <option value="week">Week</option>
          <option value="quarter">Quarter</option>
          <option value="julian">Julian Date</option>
        </select>
      </div>
      <div class="pl-key-pair" style="margin-top:4px">
        <span class="pl-key-pair-label">Format</span>
        <div class="tab-row" style="margin-left:0">
          <label class="tab-opt">
            <input type="radio" name={`dateOutput_${i}`} value="number" checked={output === 'number'}
              onChange={e => onPropChange('dateOutput', (e.target as HTMLInputElement).value)} />
            <span>Number</span>
          </label>
          <label class={`tab-opt${textOnly ? ' tab-opt--disabled' : ''}`}>
            <input type="radio" name={`dateOutput_${i}`} value="short" checked={output === 'short'} disabled={textOnly}
              onChange={e => onPropChange('dateOutput', (e.target as HTMLInputElement).value)} />
            <span>Short</span>
          </label>
          <label class={`tab-opt${textOnly ? ' tab-opt--disabled' : ''}`}>
            <input type="radio" name={`dateOutput_${i}`} value="text" checked={output === 'text' && !textOnly} disabled={textOnly}
              onChange={e => onPropChange('dateOutput', (e.target as HTMLInputElement).value)} />
            <span>Full</span>
          </label>
        </div>
      </div>
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
