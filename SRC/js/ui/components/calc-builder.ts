import { h } from '../../core/utils.js';

export interface CalcBuilderCtx {
  calc: CalcStage;
  i: number;
  cols: string[];
  colOptsFor: (sel: string) => string;
}

export function renderMathBuilder(ctx: CalcBuilderCtx): string {
  const { calc, i, colOptsFor } = ctx;
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

  return `
    <div class="pl-key-pair" style="margin-top:8px">
      <span class="pl-key-pair-label">Type</span>
      <select data-ci="${i}" data-cp="mathOp" style="width:140px;flex-shrink:0">
        <option value="ARITH" ${!isRollingAvg && !isPctTotal ? 'selected' : ''}>Arithmetic</option>
        <option value="ROLLAVG" ${isRollingAvg ? 'selected' : ''}>Rolling Avg</option>
        <option value="PCTTOTAL" ${isPctTotal ? 'selected' : ''}>% of Total</option>
      </select>
    </div>
    ${!isRollingAvg && !isPctTotal ? `
    <div class="pl-key-pair" style="margin-top:6px">
      <select data-ci="${i}" data-cp="leftCol" style="min-width:160px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(leftCol)}
      </select>
      <select data-ci="${i}" data-cp="mathOperator" style="width:70px;flex-shrink:0">
        <option value="+" ${mathOp === '+' ? 'selected' : ''}>+</option>
        <option value="-" ${mathOp === '-' ? 'selected' : ''}>\u2212</option>
        <option value="*" ${mathOp === '*' ? 'selected' : ''}>\u00D7</option>
        <option value="/" ${mathOp === '/' ? 'selected' : ''}>\u00F7</option>
      </select>
      <select data-ci="${i}" data-cp="rightCol" style="min-width:160px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(rightCol)}
      </select>
    </div>` : ''}
    ${isRollingAvg ? `
    <div class="pl-key-pair" style="margin-top:6px">
      <span class="pl-key-pair-label">Source</span>
      <select data-ci="${i}" data-cp="leftCol" style="min-width:190px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(leftCol)}
      </select>
      <span class="pl-key-pair-label" style="margin-left:6px">Window</span>
      <input type="number" min="1" step="1" value="${windowVal}" data-ci="${i}" data-cp="window" style="width:80px;flex-shrink:0">
    </div>` : ''}
    ${isPctTotal ? `
    <div class="pl-key-pair" style="margin-top:6px">
      <span class="pl-key-pair-label">Source</span>
      <select data-ci="${i}" data-cp="leftCol" style="min-width:190px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(leftCol)}
      </select>
    </div>` : ''}`;
}

export function renderTextBuilder(ctx: CalcBuilderCtx): string {
  const { calc, i, colOptsFor } = ctx;
  const text = calc.text as { operation?: string; parts?: Array<{ type?: string; value?: string }>; source?: { type?: string; value?: string }; count?: number; start?: number; length?: number } | undefined;
  const op = text?.operation || 'combine';

  if (op === 'combine') {
    const parts = text?.parts || [];
    return `
      <div style="margin-top:8px;font-size:0.76rem;color:var(--muted)">Combine parts: ${parts.length} part(s)</div>
      <div style="margin-top:4px;font-size:0.7rem;color:var(--muted)">Edit via report setup file for complex combinations.</div>`;
  }
  if (op === 'left' || op === 'right') {
    const src = text?.source;
    const srcCol = src?.type === 'column' ? (src.value || '') : '';
    const count = text?.count || 1;
    return `
      <div class="pl-key-pair" style="margin-top:8px">
        <span class="pl-key-pair-label">Source</span>
        <select data-ci="${i}" data-cp="textSource" style="min-width:190px">
          <option value="">\u2014 column \u2014</option>${colOptsFor(srcCol)}
        </select>
        <span class="pl-key-pair-label" style="margin-left:6px">Count</span>
        <input type="number" min="1" step="1" value="${count}" data-ci="${i}" data-cp="textCount" style="width:80px;flex-shrink:0">
      </div>`;
  }
  if (op === 'substring') {
    const src = text?.source;
    const srcCol = src?.type === 'column' ? (src.value || '') : '';
    const start = text?.start || 1;
    const length = text?.length || 1;
    return `
      <div class="pl-key-pair" style="margin-top:8px">
        <span class="pl-key-pair-label">Source</span>
        <select data-ci="${i}" data-cp="textSource" style="min-width:190px">
          <option value="">\u2014 column \u2014</option>${colOptsFor(srcCol)}
        </select>
      </div>
      <div class="pl-key-pair" style="margin-top:4px">
        <span class="pl-key-pair-label">Start</span>
        <input type="number" min="1" step="1" value="${start}" data-ci="${i}" data-cp="textStart" style="width:80px;flex-shrink:0">
        <span class="pl-key-pair-label" style="margin-left:6px">Length</span>
        <input type="number" min="1" step="1" value="${length}" data-ci="${i}" data-cp="textLength" style="width:80px;flex-shrink:0">
      </div>`;
  }
  return '';
}

export function renderCompareBuilder(ctx: CalcBuilderCtx): string {
  const { calc, i, colOptsFor } = ctx;
  const compare = calc.compare as { compareMode?: string; conditions?: Array<{ col?: string; op?: string; val?: string }>; trueValue?: { type?: string; value?: string }; falseValue?: { type?: string; value?: string } } | undefined;
  const glue = compare?.compareMode || 'AND';
  const conditions = compare?.conditions || [];
  const trueVal = compare?.trueValue;
  const falseVal = compare?.falseValue;

  const COND_OPS = ['=', '!=', '>', '>=', '<', '<='];
  const condOptsFor = (selOp: string) => COND_OPS
    .map(o => `<option value="${h(o)}" ${selOp === o ? 'selected' : ''}>${h(o)}</option>`)
    .join('');

  const conditionsHtml = conditions.map((cond, j) => `
    <div class="pl-key-pair" style="margin-top:${j === 0 ? '6px' : '4px'}">
      <span class="pl-key-pair-label">${j === 0 ? 'Where' : glue}</span>
      <select data-ci="${i}" data-cond="${j}" data-cp="col" style="min-width:140px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(cond.col || '')}
      </select>
      <select data-ci="${i}" data-cond="${j}" data-cp="op" style="width:62px;flex-shrink:0">
        ${condOptsFor(cond.op || '=')}
      </select>
      <input type="text" data-ci="${i}" data-cond="${j}" data-cp="val" placeholder="value" value="${h(cond.val || '')}" style="min-width:100px">
    </div>`).join('');

  return `
    <div class="pl-key-pair" style="margin-top:8px">
      <span class="pl-key-pair-label">Match</span>
      <select data-ci="${i}" data-cp="compareMode" style="width:80px;flex-shrink:0">
        <option value="AND" ${glue === 'AND' ? 'selected' : ''}>ALL</option>
        <option value="OR" ${glue === 'OR' ? 'selected' : ''}>ANY</option>
      </select>
      <span style="font-size:0.72rem;color:var(--muted)">of these conditions:</span>
    </div>
    ${conditionsHtml}
    <div style="margin-top:6px;font-size:0.72rem;color:var(--muted)">
      Returns: ${trueVal?.type === 'text' ? `"${h(trueVal.value || '')}"` : trueVal?.value || '1'} if match, ${falseVal?.type === 'text' ? `"${h(falseVal.value || '')}"` : falseVal?.value || '0'} if not
    </div>`;
}

export function renderDateBuilder(ctx: CalcBuilderCtx): string {
  const { calc, i, colOptsFor } = ctx;
  const date = calc.date as { operation?: string; source?: { type?: string; value?: string }; part?: string; output?: string; inputFormat?: { first?: string; second?: string; third?: string } } | undefined;
  const src = date?.source;
  const srcCol = src?.type === 'column' ? (src.value || '') : '';
  const part = date?.part || 'year';
  const output = date?.output || 'text';
  const fmt = date?.inputFormat || {};
  const fmtFirst = fmt.first || 'MM';
  const fmtSecond = fmt.second || 'DD';
  const fmtThird = fmt.third || 'YYYY';

  const textOnly = part === 'year' || part === 'week';
  const shortDisabled = textOnly ? ' disabled' : '';
  const fullDisabled = textOnly ? ' disabled' : '';

  const fmtOpts = (sel: string) => {
    const opts: Array<[string, string]> = [['D','D'],['DD','DD'],['M','M'],['MM','MM'],['MMM','MMM'],['YY','YY'],['YYYY','YYYY']];
    return opts.map(([val, label]) => `<option value="${val}" ${sel === val ? 'selected' : ''}>${label}</option>`).join('');
  };

  return `
    <div class="pl-key-pair" style="margin-top:8px">
      <span class="pl-key-pair-label">Source</span>
      <select data-ci="${i}" data-cp="dateSource" style="min-width:190px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(srcCol)}
      </select>
    </div>
    <div class="pl-key-pair" style="margin-top:4px">
      <span class="pl-key-pair-label">Input format</span>
      <div style="display:flex;gap:2px;align-items:center">
        <select data-ci="${i}" data-cp="dateFmtFirst" style="width:65px">${fmtOpts(fmtFirst)}</select>
        <span style="color:var(--muted)">/</span>
        <select data-ci="${i}" data-cp="dateFmtSecond" style="width:65px">${fmtOpts(fmtSecond)}</select>
        <span style="color:var(--muted)">/</span>
        <select data-ci="${i}" data-cp="dateFmtThird" style="width:65px">${fmtOpts(fmtThird)}</select>
      </div>
    </div>
    <div class="pl-key-pair" style="margin-top:4px">
      <span class="pl-key-pair-label">Extract</span>
      <select data-ci="${i}" data-cp="datePart" style="width:140px;flex-shrink:0">
        <option value="year" ${part === 'year' ? 'selected' : ''}>Year</option>
        <option value="month" ${part === 'month' ? 'selected' : ''}>Month</option>
        <option value="day" ${part === 'day' ? 'selected' : ''}>Day</option>
        <option value="dow" ${part === 'dow' ? 'selected' : ''}>Day of Week</option>
        <option value="week" ${part === 'week' ? 'selected' : ''}>Week</option>
        <option value="quarter" ${part === 'quarter' ? 'selected' : ''}>Quarter</option>
        <option value="julian" ${part === 'julian' ? 'selected' : ''}>Julian Date</option>
      </select>
    </div>
    <div class="pl-key-pair" style="margin-top:4px">
      <span class="pl-key-pair-label">Format</span>
      <div class="tab-row" style="margin-left:0">
        <label class="tab-opt"><input type="radio" name="dateOutput_${i}" value="number" ${output === 'number' ? 'checked' : ''} data-ci="${i}" data-cp="dateOutput"><span>Number</span></label>
        <label class="tab-opt${textOnly ? ' tab-opt--disabled' : ''}"><input type="radio" name="dateOutput_${i}" value="short" ${output === 'short' ? 'checked' : ''}${shortDisabled} data-ci="${i}" data-cp="dateOutput"><span>Short</span></label>
        <label class="tab-opt${textOnly ? ' tab-opt--disabled' : ''}"><input type="radio" name="dateOutput_${i}" value="text" ${output === 'text' && !textOnly ? 'checked' : ''}${fullDisabled} data-ci="${i}" data-cp="dateOutput"><span>Full</span></label>
      </div>
    </div>`;
}

export const calcModeRenderers: Record<string, (ctx: CalcBuilderCtx) => string> = {
  math:    renderMathBuilder,
  text:    renderTextBuilder,
  compare: renderCompareBuilder,
  date:    renderDateBuilder,
};
