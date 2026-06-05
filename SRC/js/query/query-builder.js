'use strict';

// Error caches populated by _checkAllLookups() / _checkAllCalcs() before each validation pass.
// validation.js reads these via getLookupDupErrors() / getCalcErrors() so that config objects
// do NOT carry _dupError / _error as mutable authoritative state.
const _lookupDupErrorCache = new Map(); // lookup-index → error string
const _calcErrorCache       = new Map(); // calc-index   → error string
function getLookupDupErrors() { return _lookupDupErrorCache; }
function getCalcErrors()      { return _calcErrorCache; }

// Tracks every column alias that has ever been part of the projection.
let _seenCols = new Set();
let _previewOpen = new Set(); // stage keys where preview is expanded

function _sampleTipFor(tid, col, extra = []) {
  const tbl  = db.tables?.[tid];
  const vals = (tbl?.samples?.[col] || []).slice(0, 3).map(v => String(v));
  const lines = [
    `From sheet: ${tbl?.name || tid}`,
    vals.length ? `Sample values: ${vals.join(' · ')}` : 'Sample values: (none found)',
    ...extra,
  ];
  return `data-tip="${lines.map(line => h(line)).join('&#10;')}"`;
}

function _isSourceVisibleInLayout(tid, col, colMap, mode) {
  if (!(db.selCols instanceof Set)) return true;
  let seen = false;
  for (const [alias, src] of colMap.entries()) {
    if (src?.tid !== tid || src?.col !== col) continue;
    seen = true;
    if (db.selCols.has(alias)) return true;
  }
  return !seen;
}

function _setLayoutAliasesForSourceVisibility(tid, col = null, isVisible = true) {
  const mode = db.aggMode || 'none';
  if (!tid) return;
  const aliases = projectedCols();
  if (!(db.selCols instanceof Set)) db.selCols = new Set(aliases);
  const colMap = buildColSourceMap();
  for (const alias of aliases) {
    const src = colMap.get(alias);
    if (src?.tid !== tid) continue;
    if (col !== null && src?.col !== col) continue;
    if (isVisible) db.selCols.add(alias);
    else db.selCols.delete(alias);
  }
}

function _showLayoutAliasesForSource(tid, col = null) {
  _setLayoutAliasesForSourceVisibility(tid, col, true);
}

function _hideLayoutAliasesForSource(tid, col = null) {
  _setLayoutAliasesForSourceVisibility(tid, col, false);
}

function _lookupColumnUsedElsewhere(tid, col, excludeLookupIndex = -1) {
  const lookups = Array.isArray(db.lookups) ? db.lookups : [];
  for (let i = 0; i < lookups.length; i++) {
    if (i === excludeLookupIndex) continue;
    const lk = lookups[i];
    if (!lk || lk.rightId !== tid) continue;
    if (Array.isArray(lk.cols) && lk.cols.includes(col)) return true;
  }
  return false;
}

function _hideLookupLayoutAliasesSafely(tid, col = null, excludeLookupIndex = -1) {
  const rt = tid ? db.tables?.[tid] : null;
  if (!rt || !Array.isArray(rt.cols)) return;
  const cols = col === null ? rt.cols : [col];
  for (const c of cols) {
    if (_lookupColumnUsedElsewhere(tid, c, excludeLookupIndex)) continue;
    _hideLayoutAliasesForSource(tid, c);
  }
}

function _isAliasVisibleInLayout(alias, mode) {
  if (!alias) return true;
  if (!(db.selCols instanceof Set)) return true;
  return db.selCols.has(alias);
}

// ── Top-level render ──────────────────────────────────────────────────────────
function renderQueryBuilder() {
  // Invalidate validation cache so all sub-renderers see fresh state this cycle.
  invalidateValidation();

  const ids = Object.keys(db.tables).sort((a, b) => db.tables[a].name.localeCompare(db.tables[b].name));

  const qEmpty = document.getElementById('qEmpty');
  const qBuilder = document.getElementById('qBuilder');
  if (qEmpty) qEmpty.style.display = ids.length ? 'none' : '';
  if (qBuilder) qBuilder.style.display = ids.length ? 'grid' : 'none';

  if (!ids.length) return;

  // Keep duplicate-key guard state in sync with currently loaded data
  _checkAllLookups();
  _checkAllCalcs();

  const hasBase = !!db.base && !!db.tables[db.base];
  const hasBaseConfigured = !!db.base; // base is set in config, even if sheet not loaded

  ['colCard', 'filterSortCard'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = hasBase ? '' : 'none';
  });

  // Show runRow whenever a base is configured — even when the sheet is missing —
  // so the Blocked indicator is visible and users can see why the report can't run.
  const runRowEl = document.getElementById('runRow');
  if (runRowEl) runRowEl.style.display = hasBaseConfigured ? '' : 'none';

  // Update Healthy/Blocked status pill and run button state.
  if (hasBaseConfigured) {
    const v         = getValidation();
    const blocked   = v.reportStatus === 'blocked';
    const issueCount = Object.values(v.items).filter(it => it.blocking).length;

    const pill    = document.getElementById('reportStatusPill');
    const runBtn  = document.getElementById('runBtn');

    if (pill) {
      pill.style.display = '';
      if (blocked) {
        pill.textContent   = `\u26A0 Blocked (${issueCount} issue${issueCount !== 1 ? 's' : ''})`;
        pill.style.background  = 'rgba(200,60,60,0.18)';
        pill.style.color       = '#e07070';
        pill.style.border      = '1px solid rgba(200,60,60,0.35)';
      } else {
        pill.textContent   = '\u2713 Healthy';
        pill.style.background  = 'rgba(50,180,100,0.15)';
        pill.style.color       = '#6ec87e';
        pill.style.border      = '1px solid rgba(50,180,100,0.3)';
      }
    }
    if (runBtn) runBtn.disabled = blocked;
  }

  renderPipeline(ids);

  if (!hasBase) return;
  renderColChips();
  renderFilters();
  renderSorts();
  renderAggregation();

  // Keep merge-duplicate checkboxes visible after setup/template loads,
  // even before a report run populates the results grid.
  try {
    renderMergeToggles(projectedCols());
  } catch (_) {}
}

function onBaseChange(val) {
  db.base       = val;
  db.baseCols   = null;
  db.stacks     = [];
  db.lookups    = [];
  db.calcStages = [];
  db.selCols    = null;
  db.colOrder   = null;
  db.groupBy    = [];
  db.aggregates = [];
  db.aggMode    = 'none';
  db.aggModeState = null;
  db.colTotals  = {};
  db.sorts      = [];
  db.filters    = [];
  _seenCols     = new Set();
  _previewOpen  = new Set();
  renderQueryBuilder();
}

// ── Pipeline renderer ─────────────────────────────────────────────────────────
function renderPipeline(ids) {
  const pl = document.getElementById('pipeline');
  const sortedIds = ids.sort((a, b) => db.tables[a].name.localeCompare(db.tables[b].name));
  const usedAsLookup = new Set((db.lookups || []).map(l => l.rightId).filter(Boolean));
  const usedAsStack  = new Set(db.stacks || []);
  const layoutColMap = db.base && db.tables[db.base] ? buildColSourceMap() : new Map();
  const layoutMode = db.aggMode || 'none';

  // Available sheets for stack/lookup (not already used)
  const stackAvail  = sortedIds.filter(id => id !== db.base && !usedAsStack.has(id) && !usedAsLookup.has(id));
  const lookupAvail = sortedIds.filter(id => id !== db.base && !usedAsStack.has(id) && !usedAsLookup.has(id));

  let html = '';

  // ── Top pair: Start From → Include Rows (side-by-side) ───────────────────
  const stackSheetsHtml = db.base && db.tables[db.base] ? `
    <div class="pl-stack-sheets" id="plStackSheets">
      ${(db.stacks || []).filter(id => db.tables[id]).map(id => `
        <span class="pl-stack-chip" style="border-left:3px solid ${getTableColor(id)}">
          ${h(db.tables[id].name)}
          <span class="rm" data-rmstack="${id}">×</span>
        </span>`).join('')}
      ${stackAvail.length ? `
        <div class="pl-add-btn" id="plStackAddBtn">＋ Include</div>
        <select class="pl-add-select" id="plStackSel" onchange="addStack(this.value)">
          <option value="">pick a sheet…</option>
          ${stackAvail.map(id => `<option value="${id}">${h(db.tables[id].name)}</option>`).join('')}
        </select>` : ''}
    </div>` : '<span style="font-size:0.76rem;color:var(--muted)">← Pick a sheet first</span>';

  const baseColChipsHtml = db.base && db.tables[db.base] ? (() => {
    const allCols   = db.tables[db.base].cols;
    return `<div class="pl-lookup-cols" style="margin-top:6px">
      <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Columns:</span>
      ${allCols.map(c => {
        const isLayoutVisible = _isSourceVisibleInLayout(db.base, c, layoutColMap, layoutMode);
        const color     = getTableColor(db.base);
        const chipStyle = `background:${color};border-color:${color};color:${chipFgColor(color)}`;
        return `<span class="pl-col-chip on ${isLayoutVisible ? '' : 'pl-col-chip-layout-hidden'}" data-bcc="${h(c)}" style="${chipStyle}" ${_sampleTipFor(db.base, c, ['Click to show/hide this column in the report layout.'])}>${h(colUserLabel(db.base, c))}</span>`;
      }).join('')}
      <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0" data-bc-all="1">All</button>
      <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0" data-bc-none="1">None</button>
    </div>`;
  })() : '';

  html += `<div class="pl-top-pair">
    <div class="pl-stage">
      <div class="pl-stage-label">Start from</div>
      <div class="pl-base-row">
        <select id="baseSelect" onchange="onBaseChange(this.value)">
          <option value="">— select a sheet —</option>
          ${sortedIds.map(id => `<option value="${id}" ${db.base === id ? 'selected' : ''}>${h(db.tables[id].name)}</option>`).join('')}
        </select>
      </div>
      ${baseColChipsHtml}
    </div>
    <div class="pl-h-arrow"><div class="pl-h-line"></div><div class="pl-h-head"></div></div>
    <div class="pl-stage">
      <div class="pl-stage-label">Include rows from <span class="tip" data-tip="Add sheets with the same columns to get more rows. Like stacking spreadsheets on top of each other.">?</span></div>
      ${stackSheetsHtml}
    </div>
  </div>`;

  if (!db.base || !db.tables[db.base]) { pl.innerHTML = html; return; }

  // ── Vertical arrow + preview after top pair ────────────────────────────────
  html += _plArrow('base');

  // ── Lookup stages ──────────────────────────────────────────────────────────
  (db.lookups || []).forEach((lk, i) => {
    html += _plLookupStage(lk, i, sortedIds, usedAsLookup, usedAsStack, layoutColMap, layoutMode);
    html += _plArrow(`lk${i}`);
  });

  // ── Calculated stages ──────────────────────────────────────────────────────
  (db.calcStages || []).forEach((calc, i) => {
    html += _plCalcStage(calc, i);
    html += _plArrow(`calc${i}`);
  });

  // ── Add stage buttons ─────────────────────────────────────────────────────
  html += `<div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;padding:2px 0 8px">
    <div class="pl-add-btn" onclick="addLookup()">＋ Look up columns from another sheet</div>
    <div class="pl-add-btn" onclick="addCalcStage()">＋ Add a calculated column from existing sheets</div>
  </div>`;

  pl.innerHTML = html;

  // Attach stack add-btn click to show hidden select
  const addBtn = pl.querySelector('#plStackAddBtn');
  const addSel = pl.querySelector('#plStackSel');
  if (addBtn && addSel) {
    addBtn.addEventListener('click', () => {
      // Position select near button then focus
      addSel.style.cssText = 'position:absolute;opacity:1;pointer-events:auto;width:auto;height:auto';
      const r = addBtn.getBoundingClientRect();
      addSel.style.top  = (r.bottom + window.scrollY + 2) + 'px';
      addSel.style.left = r.left + 'px';
      document.body.appendChild(addSel);
      addSel.focus();
      addSel.addEventListener('blur', () => {
        addSel.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:0;height:0';
        pl.querySelector('#plStackSheets')?.appendChild(addSel);
      }, { once: true });
    });
  }

  // Stack remove chips
  pl.querySelectorAll('[data-rmstack]').forEach(el => {
    el.addEventListener('click', () => removeStack(el.dataset.rmstack));
  });

  // Lookup remove
  pl.querySelectorAll('[data-rmlookup]').forEach(el => {
    el.addEventListener('click', () => removeLookup(+el.dataset.rmlookup));
  });

  // Calc remove
  pl.querySelectorAll('[data-rmcalc]').forEach(el => {
    el.addEventListener('click', () => removeCalcStage(+el.dataset.rmcalc));
  });

  // Remove single key pair
  pl.querySelectorAll('[data-rmlkp]').forEach(el => {
    el.addEventListener('click', () => {
      const lk = db.lookups[+el.dataset.li];
      if (!lk || !Array.isArray(lk.keyPairs) || lk.keyPairs.length <= 1) return;
      lk.keyPairs.splice(+el.dataset.lkp, 1);
      _afterCombineChange();
    });
  });

  // Add key pair
  pl.querySelectorAll('[data-addlkp]').forEach(el => {
    el.addEventListener('click', () => {
      const lk = db.lookups[+el.dataset.addlkp];
      if (!lk) return;
      if (!Array.isArray(lk.keyPairs)) lk.keyPairs = [];
      lk.keyPairs.push({ left: '', right: '' });
      _afterCombineChange();
    });
  });

  // Lookup selects / radios
  pl.querySelectorAll('[data-li]').forEach(el => {
    el.addEventListener('change', e => {
      const i  = +e.target.dataset.li;
      const lp = e.target.dataset.lp;
      if (!lp) return;
      const lk = db.lookups[i];
      if (lp === 'enabled') {
        lk.enabled = e.target.checked;
        _afterCombineChange();
        return;
      }
      if (lp === 'rightId') {
        const prevRightId = lk.rightId;
        lk.rightId   = e.target.value;
        lk.keyPairs  = [{ left: '', right: '' }];
        const rt = lk.rightId && db.tables[lk.rightId];
        lk.cols = rt ? [...rt.cols] : [];
        if (prevRightId && prevRightId !== lk.rightId) _hideLookupLayoutAliasesSafely(prevRightId, null, i);
        if (lk.rightId) _showLayoutAliasesForSource(lk.rightId);
      } else if (lp === 'required') {
        lk.required = e.target.value === '1';
      } else if (lp === 'dupMode') {
        if (!lk.duplicatePolicy) lk.duplicatePolicy = { mode: 'block' };
        lk.duplicatePolicy.mode = e.target.value;
      } else if (lp === 'kpLeft' || lp === 'kpRight') {
        const pi = +e.target.dataset.lkp;
        if (!Array.isArray(lk.keyPairs)) lk.keyPairs = [{ left: '', right: '' }];
        if (!lk.keyPairs[pi]) lk.keyPairs[pi] = { left: '', right: '' };
        if (lp === 'kpLeft')  lk.keyPairs[pi].left  = e.target.value;
        if (lp === 'kpRight') lk.keyPairs[pi].right = e.target.value;
      } else {
        lk[lp] = e.target.value;
      }
      _afterCombineChange();
    });
  });

  // Calc inputs
  pl.querySelectorAll('[data-ci]').forEach(el => {
    el.addEventListener('change', e => {
      const i    = +e.target.dataset.ci;
      const cp   = e.target.dataset.cp;
      const condIdx = e.target.dataset.cond;
      if (!cp) return;
      const c = db.calcStages?.[i];
      if (!c) return;
      if (condIdx !== undefined) {
        // Condition field (col, op, or val)
        const j = +condIdx;
        if (!Array.isArray(c.conditions)) c.conditions = [];
        if (!c.conditions[j]) c.conditions[j] = { col: '', op: '=', val: '' };
        c.conditions[j][cp] = e.target.value;
      } else if (cp === 'enabled') {
        c.enabled = e.target.checked;
        _afterCombineChange();
        return;
      } else if (cp === 'alias') {
        const oldAlias = (c.alias || '').trim();
        c.alias = e.target.value;
        const newAlias = (c.alias || '').trim();
        _renameProjectedAliasRefs(oldAlias, newAlias);
      } else if (cp === 'explicitOrder') {
        c.explicitOrder = !!e.target.checked;
      } else if (cp === 'customTF') {
        c.customTF = !!e.target.checked;
      } else if (cp === 'window') {
        c.window = Math.max(1, parseInt(e.target.value, 10) || 1);
      } else if (cp === 'op') {
        c[cp] = e.target.value;
        // Auto-initialize conditions when switching to COMPARE
        if (e.target.value === 'COMPARE' && (!Array.isArray(c.conditions) || !c.conditions.length)) {
          c.conditions = [{ col: '', op: '=', val: '' }];
        }
        if (e.target.value === 'COMPARE') {
          c.compareMode = c.compareMode === 'OR' ? 'OR' : 'AND';
        }
      } else {
        c[cp] = e.target.value;
      }
      _afterCombineChange();
    });

    // Also handle live input for condition val fields
    if (el.tagName === 'INPUT' && el.dataset.cond !== undefined && el.dataset.cp === 'val') {
      el.addEventListener('input', e => {
        const i = +e.target.dataset.ci;
        const j = +e.target.dataset.cond;
        const c = db.calcStages?.[i];
        if (!c || !Array.isArray(c.conditions) || !c.conditions[j]) return;
        c.conditions[j].val = e.target.value;
      });
    }
    // Also handle live input for trueVal / falseVal fields
    // el.dataset.cond === undefined ensures we only match top-level calc inputs,
    // not per-condition val inputs which also carry data-cp="val" and data-cond.
    if (el.tagName === 'INPUT' && el.dataset.cond === undefined && (el.dataset.cp === 'trueVal' || el.dataset.cp === 'falseVal')) {
      el.addEventListener('input', e => {
        const i = +e.target.dataset.ci;
        const cp = e.target.dataset.cp;
        const c = db.calcStages?.[i];
        if (!c) return;
        c[cp] = e.target.value;
        _afterCombineChange();
      });
    }
  });

  // Add condition button
  pl.querySelectorAll('[data-addcond]').forEach(el => {
    el.addEventListener('click', () => {
      const i = +el.dataset.addcond;
      const cm = el.dataset.cm === 'OR' ? 'OR' : 'AND';
      const c = db.calcStages?.[i];
      if (!c) return;
      if (!Array.isArray(c.conditions)) c.conditions = [];
      c.compareMode = cm;
      c.conditions.push({ col: '', op: '=', val: '' });
      _afterCombineChange();
    });
  });

  // Remove condition button
  pl.querySelectorAll('[data-rmcond]').forEach(el => {
    el.addEventListener('click', () => {
      const i = +el.dataset.ci;
      const j = +el.dataset.rmcond;
      const c = db.calcStages?.[i];
      if (!c || !Array.isArray(c.conditions) || c.conditions.length <= 1) return;
      c.conditions.splice(j, 1);
      _afterCombineChange();
    });
  });

  // Lookup column chips
  pl.querySelectorAll('[data-lcc]').forEach(el => {
    el.addEventListener('click', () => {
      const i   = +el.dataset.li;
      const col = el.dataset.lcc;
      const lk  = db.lookups[i];
      const colMap = buildColSourceMap();
      const isLayoutVisible = _isSourceVisibleInLayout(lk.rightId, col, colMap, db.aggMode || 'none');
      if (isLayoutVisible) _hideLookupLayoutAliasesSafely(lk.rightId, col, i);
      else _showLayoutAliasesForSource(lk.rightId, col);
      _afterCombineChange();
    });
  });

  // Base column chips
  pl.querySelectorAll('[data-bcc]').forEach(el => {
    el.addEventListener('click', () => {
      const col    = el.dataset.bcc;
      const colMap = buildColSourceMap();
      const isLayoutVisible = _isSourceVisibleInLayout(db.base, col, colMap, db.aggMode || 'none');
      if (isLayoutVisible) _hideLayoutAliasesForSource(db.base, col);
      else _showLayoutAliasesForSource(db.base, col);
      _afterCombineChange();
    });
  });

  // Calculated output chip
  pl.querySelectorAll('[data-ccc]').forEach(el => {
    el.addEventListener('click', () => {
      const i = +el.dataset.ci;
      const c = db.calcStages?.[i];
      const alias = (c?.alias || '').trim();
      if (!alias) return;
      if (!db.selCols) db.selCols = new Set(projectedCols());
      if (db.selCols.has(alias)) db.selCols.delete(alias);
      else db.selCols.add(alias);
      _afterCombineChange();
    });
  });

  // All/None base col buttons
  pl.querySelector('[data-bc-all]')?.addEventListener('click', () => {
    _showLayoutAliasesForSource(db.base);
    _afterCombineChange();
  });
  pl.querySelector('[data-bc-none]')?.addEventListener('click', () => {
    _hideLayoutAliasesForSource(db.base);
    _afterCombineChange();
  });

  // All/None lookup col buttons
  pl.querySelectorAll('[data-lk-all]').forEach(el => {
    el.addEventListener('click', () => selectAllLookupCols(+el.dataset.lkAll));
  });
  pl.querySelectorAll('[data-lk-none]').forEach(el => {
    el.addEventListener('click', () => selectNoneLookupCols(+el.dataset.lkNone));
  });

  // Preview buttons
  pl.querySelectorAll('[data-preview]').forEach(el => {
    el.addEventListener('click', () => togglePreview(el.dataset.preview));
  });
}

function _plArrow(key) {
  const isOpen = _previewOpen.has(key);
  return `<div class="pl-arrow">
    <div class="pl-arrow-line"></div>
    <div class="pl-arrow-meta">
      <button class="pl-preview-btn" data-preview="${key}">${isOpen ? '▲ Hide preview' : '▼ Preview'}</button>
    </div>
    <div class="pl-arrow-line"></div>
    <div class="pl-arrow-head"></div>
    ${isOpen ? `<div class="pl-mini-preview" id="preview_${key}">${_buildPreviewHTML(key)}</div>` : ''}
  </div>`;
}

function _plLookupStage(lk, i, sortedIds, usedAsLookup, usedAsStack, layoutColMap, layoutMode) {
  const rt        = lk.rightId && db.tables[lk.rightId];
  const leftCols  = projectedColsUpToLookup(i);
  const rightCols = rt ? rt.cols : [];

  if (!Array.isArray(lk.keyPairs) || !lk.keyPairs.length) lk.keyPairs = [{ left: '', right: '' }];
  const pairs = lk.keyPairs;

  // Available sheets: not base, not stack, not another lookup (but allow current rightId)
  const sheetOpts = sortedIds
    .filter(id => id !== db.base && (!usedAsLookup.has(id) || id === lk.rightId) && !usedAsStack.has(id))
    .map(id => `<option value="${id}" ${lk.rightId === id ? 'selected' : ''}>${h(db.tables[id].name)}</option>`)
    .join('');

  const lkColorCls = lk.rightId ? getTableColorClass(lk.rightId) : '';
  const lkColMap   = buildColSourceMap();
  const leftOptsFor  = val => leftCols.map(c =>
    `<option value="${h(c)}" ${val === c ? 'selected' : ''}>${h(colDisplayLabel(c, lkColMap))}</option>`).join('');
  const rightOptsFor = val => rightCols.map(c =>
    `<option value="${h(c)}" ${val === c ? 'selected' : ''}>${h(`${db.tables[lk.rightId]?.name || lk.rightId} → ${colUserLabel(lk.rightId, c)}`)}</option>`).join('');

  const keyPairsHTML = pairs.map((pair, pi) => `
    <div class="pl-key-pair">
      <span class="pl-key-pair-label">${pi === 0 ? 'Where' : 'AND'}</span>
      <select data-li="${i}" data-lkp="${pi}" data-lp="kpLeft">
        <option value="">— column —</option>${leftOptsFor(pair.left)}
      </select>
      <span class="pl-lookup-eq">=</span>
      <select data-li="${i}" data-lkp="${pi}" data-lp="kpRight">
        <option value="">— column —</option>${rightOptsFor(pair.right)}
      </select>
      ${pairs.length > 1 ? `<button class="pl-rm-kp" data-rmlkp="1" data-li="${i}" data-lkp="${pi}" title="Remove this condition">✕</button>` : ''}
    </div>`).join('');

  const colChips = rt ? rt.cols.map(c => {
    const isLayoutVisible = _isSourceVisibleInLayout(lk.rightId, c, layoutColMap, layoutMode);
    return `<span class="pl-col-chip on ${isLayoutVisible ? '' : 'pl-col-chip-layout-hidden'} ${lkColorCls}" data-li="${i}" data-lcc="${h(c)}" ${_sampleTipFor(lk.rightId, c, ['Click to show/hide this lookup column in the report layout.'])}>${h(colUserLabel(lk.rightId, c))}</span>`;
  }).join('') : '';

  const lkEnabled = lk.enabled !== false;
  const lkV = getValidation().items[`lookup_${i}`];
  const lkVBlocked = lkV && lkV.blocking;   // blocking = enabled && !resolved
  const lkVUnresolved = lkV && !lkV.resolved;
  const lkVMsg = lkVUnresolved && lkV.issues[0] ? lkV.issues[0].message : null;

  return `<div class="pl-lookup-stage${lkVBlocked ? ' pl-lookup-stage--invalid' : lkVUnresolved && !lkEnabled ? ' pl-lookup-stage--disabled-issue' : ''} ${!lkEnabled ? 'pl-stage-disabled' : ''}">
    <div class="pl-stage-label">Look up columns from <span class="tip" data-tip="Pull columns from another sheet by matching a shared value — like VLOOKUP. Use '+ AND' to match on multiple columns at once.">?</span>
      <label class="pl-enable-toggle" title="${lkEnabled ? 'Disable this lookup (won\'t block report)' : 'Enable this lookup'}"><input type="checkbox" data-li="${i}" data-lp="enabled" ${lkEnabled ? 'checked' : ''}><span class="pl-enable-label">${lkEnabled ? 'Enabled' : 'Disabled'}</span></label>
    </div>
    ${lkVMsg ? `<div class="pl-lookup-error">${lkVBlocked ? '⛔' : '⚠'} ${h(lkVMsg)}</div>` : ''}
    <div class="pl-lookup-header">
      <select data-li="${i}" data-lp="rightId">
        <option value="">— pick a sheet —</option>
        ${sheetOpts}
      </select>
      <button class="btn btn-danger" style="flex-shrink:0" data-rmlookup="${i}">✕</button>
    </div>
    ${rt ? `
    <div class="pl-lookup-keys">
      ${keyPairsHTML}
      <button class="btn btn-ghost pl-add-kp" data-addlkp="${i}">＋ AND …</button>
    </div>
    <div class="pl-lookup-required">
      <span style="flex-shrink:0">If no match:</span>
      <label><input type="radio" name="lkreq_${i}" data-li="${i}" data-lp="required" value="0" ${!lk.required ? 'checked' : ''}> Leave blank</label>
      <label><input type="radio" name="lkreq_${i}" data-li="${i}" data-lp="required" value="1" ${lk.required ? 'checked' : ''}> Skip row</label>
      <span class="tip" data-tip="Leave blank: keep all rows even if no match.&#10;Skip row: only keep rows that match.">?</span>
    </div>
    <div class="pl-lookup-required">
      <span style="flex-shrink:0">Duplicate keys:</span>
      <label><input type="radio" name="lkdup_${i}" data-li="${i}" data-lp="dupMode" value="block" ${(lk.duplicatePolicy && lk.duplicatePolicy.mode) !== 'combine' ? 'checked' : ''}> Block (error)</label>
      <label><input type="radio" name="lkdup_${i}" data-li="${i}" data-lp="dupMode" value="combine" ${(lk.duplicatePolicy && lk.duplicatePolicy.mode) === 'combine' ? 'checked' : ''}> Combine values</label>
      <span class="tip" data-tip="Block: the report cannot run if the same key appears more than once in the lookup sheet.&#10;Combine: concatenate matching values into a single cell, e.g. 'Tag1; Tag2'.">?</span>
    </div>
    <div class="pl-lookup-cols">
      <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Bring in:</span>
      ${colChips}
      <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0" data-lk-all="${i}">All</button>
      <button class="btn btn-ghost" style="font-size:0.68rem;padding:2px 6px;flex-shrink:0" data-lk-none="${i}">None</button>
    </div>` : ''}
  </div>`;
}

function _plCalcStage(calc, i) {
  const cols   = projectedCols();
  const colMap = buildColSourceMap();
  const alias  = (calc.alias || '').trim();
  const VALID_OPS = ['+', '-', '*', '/', 'ROLLAVG', 'PCTTOTAL', 'COMPARE'];
  const op = VALID_OPS.includes(calc.op) ? calc.op : '-';
  const isArithmetic = ['+', '-', '*', '/'].includes(op);
  const isRolling    = op === 'ROLLAVG';
  const isPctTotal   = op === 'PCTTOTAL';
  const isCompare    = op === 'COMPARE';
  const leftOpts = cols
    .filter(c => c !== alias)
    .map(c => `<option value="${h(c)}" ${calc.left === c ? 'selected' : ''}>${h(colDisplayLabel(c, colMap))}</option>`)
    .join('');
  const rightOpts = cols
    .filter(c => c !== alias)
    .map(c => `<option value="${h(c)}" ${calc.right === c ? 'selected' : ''}>${h(colDisplayLabel(c, colMap))}</option>`)
    .join('');
  const orderOpts = cols
    .filter(c => c !== alias)
    .map(c => `<option value="${h(c)}" ${calc.orderCol === c ? 'selected' : ''}>${h(colDisplayLabel(c, colMap))}</option>`)
    .join('');
  const windowVal = Math.max(1, parseInt(calc.window, 10) || 7);
  const explicitOrder = !!calc.explicitOrder;
  const orderDir = calc.orderDir === 'DESC' ? 'DESC' : 'ASC';

  // Build comparison ops options for conditions
  const COND_OPS = ['=', '!=', '>', '>=', '<', '<='];
  const conditions = Array.isArray(calc.conditions) ? calc.conditions : [];
  const compareMode = calc.compareMode === 'OR' ? 'OR' : 'AND';

  const condOptsFor = (selOp) => COND_OPS
    .map(o => `<option value="${h(o)}" ${selOp === o ? 'selected' : ''}>${h(o)}</option>`)
    .join('');
  const colOptsFor  = (selCol) => cols
    .filter(c => c !== alias)
    .map(c => `<option value="${h(c)}" ${selCol === c ? 'selected' : ''}>${h(colDisplayLabel(c, colMap))}</option>`)
    .join('');

  // Display labels used in the result description
  const trueDisplay  = calc.customTF && String(calc.trueVal  ?? '').trim() !== '' ? h(String(calc.trueVal))  : '1';
  const falseDisplay = calc.customTF && String(calc.falseVal ?? '').trim() !== '' ? h(String(calc.falseVal)) : '0';
  const condModeText = compareMode === 'OR' ? 'any condition is' : 'all conditions are';

  const conditionsHtml = isCompare ? `
    ${conditions.map((cond, j) => `
    <div class="pl-key-pair" style="margin-top:${j === 0 ? '6px' : '4px'}">
      <span class="pl-key-pair-label">${j === 0 ? 'Where' : compareMode}</span>
      <select data-ci="${i}" data-cond="${j}" data-cp="col" style="min-width:160px">
        <option value="">— column —</option>${colOptsFor(cond.col || '')}
      </select>
      <select data-ci="${i}" data-cond="${j}" data-cp="op" style="width:62px;flex-shrink:0">
        ${condOptsFor(cond.op || '=')}
      </select>
      <input type="text" data-ci="${i}" data-cond="${j}" data-cp="val" placeholder="value" value="${h(cond.val || '')}" style="min-width:110px">
      ${conditions.length > 1 ? `<button class="btn btn-danger" style="flex-shrink:0" data-rmcond="${j}" data-ci="${i}" title="Remove this condition">✕</button>` : ''}
    </div>`).join('')}
    <div style="margin-top:5px">
      ${conditions.length <= 1 ? `
      <button class="btn btn-ghost" style="font-size:0.76rem;padding:3px 8px" data-addcond="${i}" data-cm="AND">＋ AND …</button>
      <button class="btn btn-ghost" style="font-size:0.76rem;padding:3px 8px" data-addcond="${i}" data-cm="OR">＋ OR …</button>
      ` : `
      <button class="btn btn-ghost" style="font-size:0.76rem;padding:3px 8px" data-addcond="${i}" data-cm="${compareMode}">＋ ${compareMode} …</button>
      `}
    </div>
    <div style="margin-top:5px">
      <label style="display:flex;align-items:center;gap:6px;font-size:0.76rem;color:var(--muted)">
        <input type="checkbox" data-ci="${i}" data-cp="customTF" ${calc.customTF ? 'checked' : ''}> Custom true / false values
      </label>
      ${calc.customTF ? `
      <div class="pl-key-pair" style="margin-top:4px">
        <span class="pl-key-pair-label">True</span>
        <input type="text" data-ci="${i}" data-cp="trueVal" placeholder="e.g. Yes" value="${h(String(calc.trueVal ?? ''))}" style="width:110px;flex-shrink:0">
        <span class="pl-key-pair-label" style="margin-left:6px">False</span>
        <input type="text" data-ci="${i}" data-cp="falseVal" placeholder="e.g. No" value="${h(String(calc.falseVal ?? ''))}" style="width:110px;flex-shrink:0">
      </div>` : ''}
    </div>
    <div style="font-size:0.72rem;color:var(--muted);margin-top:4px">Result: ${trueDisplay} if ${condModeText} true, ${falseDisplay} if not</div>
  ` : '';

  const calcEnabled = calc.enabled !== false;
  const calcV = getValidation().items[`calc_${i}`];
  const calcVBlocked = calcV && calcV.blocking;
  const calcVUnresolved = calcV && !calcV.resolved;
  const calcVMsg = calcVUnresolved && calcV.issues[0] ? calcV.issues[0].message : null;

  return `<div class="pl-lookup-stage${calcVBlocked ? ' pl-lookup-stage--invalid' : calcVUnresolved && !calcEnabled ? ' pl-lookup-stage--disabled-issue' : ''} ${!calcEnabled ? 'pl-stage-disabled' : ''}">
    <div class="pl-stage-label">Calculated column <span class="tip" data-tip="Create a virtual column from existing columns.&#10;Arithmetic: uses two columns (left op right).&#10;Rolling Avg: uses the left column + window size.&#10;% of Total: uses the left column within current filtered scope.&#10;Compare: tests one or more column conditions using one mode (AND or OR) and outputs 1 (true) or 0 (false). Custom true/false values can be set.">?</span>
      <label class="pl-enable-toggle" title="${calcEnabled ? 'Disable this calculated column (won\'t block report)' : 'Enable this calculated column'}"><input type="checkbox" data-ci="${i}" data-cp="enabled" ${calcEnabled ? 'checked' : ''}><span class="pl-enable-label">${calcEnabled ? 'Enabled' : 'Disabled'}</span></label>
    </div>
    ${calcVMsg ? `<div class="pl-lookup-error">${calcVBlocked ? '⛔' : '⚠'} ${h(calcVMsg)}</div>` : ''}
    <div class="pl-lookup-header" style="gap:8px;flex-wrap:wrap">
      <input type="text" data-ci="${i}" data-cp="alias" placeholder="Output column name (e.g. Remaining to Ship)" value="${h(calc.alias || '')}" style="flex:1;min-width:180px">
      <button class="btn btn-danger" style="flex-shrink:0" data-rmcalc="${i}">✕</button>
    </div>
    ${alias ? `<div class="pl-lookup-cols" style="margin-top:6px">
      <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Output:</span>
      <span class="pl-col-chip ${_isAliasVisibleInLayout(alias, db.aggMode || 'none') ? 'on' : ''}" data-ci="${i}" data-ccc="${h(alias)}">${h(colDisplayLabel(alias, colMap))}</span>
    </div>` : ''}
    <div class="pl-key-pair" style="margin-top:8px">
      ${isCompare ? '' : `<span class="pl-key-pair-label">Formula</span>
      <select data-ci="${i}" data-cp="left" style="min-width:190px">
        <option value="">— source column —</option>${leftOpts}
      </select>`}
      <select data-ci="${i}" data-cp="op" style="width:${isCompare ? '120px' : '100px'};flex-shrink:0">
        <option value="+" ${op === '+' ? 'selected' : ''}>+</option>
        <option value="-" ${op === '-' ? 'selected' : ''}>−</option>
        <option value="*" ${op === '*' ? 'selected' : ''}>×</option>
        <option value="/" ${op === '/' ? 'selected' : ''}>÷</option>
        <option value="ROLLAVG" ${op === 'ROLLAVG' ? 'selected' : ''}>Rolling Avg</option>
        <option value="PCTTOTAL" ${op === 'PCTTOTAL' ? 'selected' : ''}>% of Total</option>
        <option value="COMPARE" ${op === 'COMPARE' ? 'selected' : ''}>Compare…</option>
      </select>
      ${isArithmetic ? `<select data-ci="${i}" data-cp="right" style="min-width:190px">
        <option value="">— compare with column —</option>${rightOpts}
      </select>` : ''}
      ${isRolling ? `<span class="pl-key-pair-label" style="margin-left:6px">Window</span>
      <input type="number" min="1" step="1" value="${windowVal}" data-ci="${i}" data-cp="window" style="width:86px;flex-shrink:0">
      <label style="display:flex;align-items:center;gap:6px;font-size:0.76rem;color:var(--muted)" title="When off, rolling uses the report Sort settings.">
        <input type="checkbox" data-ci="${i}" data-cp="explicitOrder" ${explicitOrder ? 'checked' : ''}> Use explicit order
      </label>
      ${explicitOrder ? `<select data-ci="${i}" data-cp="orderCol" style="min-width:190px">
        <option value="">— explicit order column —</option>${orderOpts}
      </select>
      <select data-ci="${i}" data-cp="orderDir" style="width:94px;flex-shrink:0">
        <option value="ASC" ${orderDir === 'ASC' ? 'selected' : ''}>ASC</option>
        <option value="DESC" ${orderDir === 'DESC' ? 'selected' : ''}>DESC</option>
      </select>` : ''}` : ''}
      ${isPctTotal ? `<span style="font-size:0.72rem;color:var(--muted);margin-left:6px">Scope: current filtered rows${(db.aggMode || 'none') === 'subtotals' && (db.subtotalBy || []).length ? ' (per subtotal group)' : ''}</span>` : ''}
    </div>
    ${isCompare ? conditionsHtml : ''}
  </div>`;
}

// ── Preview ───────────────────────────────────────────────────────────────────
function togglePreview(key) {
  if (_previewOpen.has(key)) {
    _previewOpen.delete(key);
  } else {
    _previewOpen.add(key);
  }
  const ids = Object.keys(db.tables).sort((a, b) => db.tables[a].name.localeCompare(db.tables[b].name));
  renderPipeline(ids);
}

function _buildPreviewHTML(key) {
  try {
    // Determine depth:
    // - 'base'      = after base + stacks only
    // - 'lk0'..     = after that lookup stage (no calc stages yet)
    // - 'calc0'..   = after that calculated-column stage
    let sql, params = [];
    if (key === 'base') {
      // UNION ALL of base + stacks, no lookups
      const ids = [db.base, ...(db.stacks || []).filter(id => db.tables[id])];
      if (!ids.every(id => db.tables[id])) return '<em>Not ready</em>';
      const baseCols = db.tables[db.base].cols;
      sql = ids.map(id => {
        const tCols = db.tables[id].cols;
        const sel   = baseCols.map(c => tCols.includes(c) ? quoteId(c) : 'NULL').join(', ');
        return `SELECT ${sel} FROM ${quoteId(id)}`;
      }).join(' UNION ALL ');
      sql = `SELECT * FROM (${sql}) LIMIT 5`;
    } else {
      // Stage-limited preview via temporary truncation.
      const lkMatch   = key.match(/^lk(\d+)$/);
      const calcMatch = key.match(/^calc(\d+)$/);
      if (!lkMatch && !calcMatch) return '<em>Unknown stage</em>';

      const savedLookups = db.lookups;
      const savedCalcs   = db.calcStages;

      if (lkMatch) {
        const depth = +lkMatch[1];
        db.lookups    = (db.lookups || []).slice(0, depth + 1);
        db.calcStages = []; // calc stages appear later in the pipeline
      } else {
        const depth = +calcMatch[1];
        db.lookups    = db.lookups || []; // all lookups already happened before calc stages
        db.calcStages = (db.calcStages || []).slice(0, depth + 1);
      }

      try {
        const { sql: s, params: p } = buildQuery({ mode: 'detail' });
        sql    = s.replace(/\s*(?:ORDER BY[^;]+)?$/, ' LIMIT 5');
        params = p;
      } finally {
        db.lookups    = savedLookups;
        db.calcStages = savedCalcs;
      }
    }
    const rows = execQuery(sql, params);
    if (!rows.length) return '<em style="font-size:0.72rem;color:var(--muted)">No rows</em>';
    const cols  = Object.keys(rows[0]);
    const pvMap = buildColSourceMap();
    return `<table>
      <thead><tr>${cols.map(c => `<th title="${h(c)}">${h(colDisplayLabel(c, pvMap))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r =>
        `<tr>${cols.map(c => `<td title="${h(String(r[c] ?? ''))}">${h(String(r[c] ?? ''))}</td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table>`;
  } catch (ex) {
    return `<em style="color:var(--red);font-size:0.72rem">Error: ${h(ex.message)}</em>`;
  }
}

// ── Stack / Lookup mutations ──────────────────────────────────────────────────
function addStack(id) {
  if (!id || !db.tables[id] || id === db.base) return;
  if (!db.stacks.includes(id)) db.stacks.push(id);
  _afterCombineChange();
}
function removeStack(id) {
  db.stacks = db.stacks.filter(s => s !== id);
  _afterCombineChange();
}
function addLookup() {
  if (!db.base) return;
  if (!db.lookups) db.lookups = [];
  db.lookups.push({ rightId: '', keyPairs: [{ left: '', right: '' }], cols: [], required: false, enabled: true, duplicatePolicy: { mode: 'block' } });
  _afterCombineChange();
}

function addCalcStage() {
  if (!db.base) return;
  if (!db.calcStages) db.calcStages = [];
  db.calcStages.push({
    alias: '',
    left: '',
    op: '-',
    right: '',
    conditions: [],
    compareMode: 'AND',
    customTF: false,
    trueVal: '',
    falseVal: '',
    window: 7,
    explicitOrder: false,
    orderCol: '',
    orderDir: 'ASC',
    enabled: true,
    _error: null,
  });
  _afterCombineChange();
}

function removeCalcStage(i) {
  if (!Array.isArray(db.calcStages)) db.calcStages = [];
  db.calcStages.splice(i, 1);
  _afterCombineChange();
}

function _renameProjectedAliasRefs(oldAlias, newAlias) {
  if (!oldAlias || !newAlias || oldAlias === newAlias) return;

  // Preserve Report Layout order position when a calc alias is renamed.
  if (Array.isArray(db.colOrder)) {
    const idx = db.colOrder.indexOf(oldAlias);
    if (idx >= 0) {
      if (!db.colOrder.includes(newAlias)) db.colOrder[idx] = newAlias;
      else db.colOrder.splice(idx, 1);
    }
  }

  if (db.selCols instanceof Set && db.selCols.has(oldAlias)) {
    db.selCols.delete(oldAlias);
    db.selCols.add(newAlias);
  }

  const replaceInArray = arr => {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === oldAlias) arr[i] = newAlias;
    }
  };

  replaceInArray(db.groupBy);
  replaceInArray(db.subtotalBy);
  replaceInArray(db.mergedCols);

  for (const a of (db.aggregates || [])) {
    if (a.col === oldAlias) a.col = newAlias;
  }
  for (const f of (db.filters || [])) {
    if (f.col === oldAlias) f.col = newAlias;
  }
  for (const s of (db.sorts || [])) {
    if (s.col === oldAlias) s.col = newAlias;
  }
  for (const c of (db.calcStages || [])) {
    if (c.left === oldAlias) c.left = newAlias;
    if (c.right === oldAlias) c.right = newAlias;
    if (c.orderCol === oldAlias) c.orderCol = newAlias;
    for (const cond of (c.conditions || [])) {
      if (cond.col === oldAlias) cond.col = newAlias;
    }
  }

  if (db.colTotals && Object.prototype.hasOwnProperty.call(db.colTotals, oldAlias)) {
    if (!Object.prototype.hasOwnProperty.call(db.colTotals, newAlias)) {
      db.colTotals[newAlias] = db.colTotals[oldAlias];
    }
    delete db.colTotals[oldAlias];
  }
  if (db.subtotalFns && Object.prototype.hasOwnProperty.call(db.subtotalFns, oldAlias)) {
    if (!Object.prototype.hasOwnProperty.call(db.subtotalFns, newAlias)) {
      db.subtotalFns[newAlias] = db.subtotalFns[oldAlias];
    }
    delete db.subtotalFns[oldAlias];
  }

  if (db.aggModeState && typeof db.aggModeState === 'object') {
    const replaceInSel = state => {
      if (!state || !Array.isArray(state.selCols)) return;
      for (let i = 0; i < state.selCols.length; i++) {
        if (state.selCols[i] === oldAlias) state.selCols[i] = newAlias;
      }
    };
    replaceInSel(db.aggModeState.none);
    replaceInSel(db.aggModeState.totals);
    replaceInSel(db.aggModeState.subtotals);
    const groupState = db.aggModeState.group;
    if (groupState && Array.isArray(groupState.groupBy)) {
      for (let i = 0; i < groupState.groupBy.length; i++) {
        if (groupState.groupBy[i] === oldAlias) groupState.groupBy[i] = newAlias;
      }
    }
    if (groupState && Array.isArray(groupState.aggregates)) {
      for (const a of groupState.aggregates) {
        if (a && a.col === oldAlias) a.col = newAlias;
      }
    }
    const totalsState = db.aggModeState.totals;
    if (totalsState?.colTotals && Object.prototype.hasOwnProperty.call(totalsState.colTotals, oldAlias)) {
      if (!Object.prototype.hasOwnProperty.call(totalsState.colTotals, newAlias)) {
        totalsState.colTotals[newAlias] = totalsState.colTotals[oldAlias];
      }
      delete totalsState.colTotals[oldAlias];
    }
    const subtotalsState = db.aggModeState.subtotals;
    if (subtotalsState && Array.isArray(subtotalsState.subtotalBy)) {
      for (let i = 0; i < subtotalsState.subtotalBy.length; i++) {
        if (subtotalsState.subtotalBy[i] === oldAlias) subtotalsState.subtotalBy[i] = newAlias;
      }
    }
    if (subtotalsState?.subtotalFns && Object.prototype.hasOwnProperty.call(subtotalsState.subtotalFns, oldAlias)) {
      if (!Object.prototype.hasOwnProperty.call(subtotalsState.subtotalFns, newAlias)) {
        subtotalsState.subtotalFns[newAlias] = subtotalsState.subtotalFns[oldAlias];
      }
      delete subtotalsState.subtotalFns[oldAlias];
    }
  }
}

function _calcStageError(calc, i) {
  const alias = (calc.alias || '').trim();
  if (!alias) return 'Provide a label for this calculated column.';
  const op = calc.op;
  const isArithmetic = ['+', '-', '*', '/'].includes(op);
  const isRolling    = op === 'ROLLAVG';
  const isPctTotal   = op === 'PCTTOTAL';
  const isCompare    = op === 'COMPARE';
  if (!isArithmetic && !isRolling && !isPctTotal && !isCompare) return 'Pick a valid operator.';
  if ((isRolling || isPctTotal) && (db.aggMode || 'none') === 'group') {
    return 'Rolling Avg and % of Total are available in detail/totals/subtotals modes (not summarize mode).';
  }

  if (isCompare) {
    const conditions = Array.isArray(calc.conditions) ? calc.conditions : [];
    if (!conditions.length) return 'Add at least one comparison condition.';
    const cols = new Set(projectedCols());
    for (let ci = 0; ci < conditions.length; ci++) {
      const cond = conditions[ci];
      if (!cond.col) return `Pick a column for condition ${ci + 1}.`;
      if (!cols.has(cond.col)) return `Column for condition ${ci + 1} is no longer available.`;
      if (!String(cond.val ?? '').trim()) return `Enter a value for condition ${ci + 1}.`;
      if (cond.col === alias) return 'A condition column cannot reference the output column itself.';
    }
  } else {
    if (!calc.left) return 'Pick a source column.';
    if (isArithmetic && !calc.right) return 'Pick the second source column.';
    if (isRolling) {
      const w = Math.max(1, parseInt(calc.window, 10) || 0);
      if (!Number.isFinite(w) || w < 1) return 'Rolling average window must be 1 or greater.';
      if (calc.explicitOrder && !calc.orderCol) return 'Pick an order-by column for explicit order mode.';
    }

    const cols = new Set(projectedCols());
    if (!cols.has(calc.left) || (isArithmetic && !cols.has(calc.right))) {
      return 'One or more source columns are no longer available (sheet removed or stage changed).';
    }
    if (isRolling && calc.explicitOrder && calc.orderCol && !cols.has(calc.orderCol)) {
      return 'Order-by column is no longer available.';
    }
    if (calc.left === alias || (isArithmetic && calc.right === alias) || (isRolling && calc.orderCol === alias)) {
      return 'A column cannot reference itself.';
    }
  }

  // Alias conflicts with existing non-calc columns or duplicates another calc alias.
  const map = buildColSourceMap();
  const src = map.get(alias);
  if (src && src.kind !== 'calc') {
    return 'Label conflicts with an existing column name.';
  }
  const duplicates = (db.calcStages || []).filter((c, idx) => idx !== i && (c.alias || '').trim() === alias);
  if (duplicates.length) return 'Label must be unique across calculated columns.';

  return null;
}

function _checkAllCalcs() {
  if (!Array.isArray(db.calcStages)) db.calcStages = [];
  _calcErrorCache.clear();
  for (let i = 0; i < db.calcStages.length; i++) {
    const err = _calcStageError(db.calcStages[i], i);
    if (err) _calcErrorCache.set(i, err);
  }
}

function _syncSubtotalByToLayout() {
  if (!Array.isArray(db.subtotalBy) || !db.subtotalBy.length) return;
  const order = Array.isArray(db.colOrder) ? db.colOrder : projectedCols();
  const orderIdx = new Map(order.map((c, i) => [c, i]));
  const seen = new Set();
  db.subtotalBy = db.subtotalBy
    .filter(c => orderIdx.has(c) && !seen.has(c) && (seen.add(c), true))
    .sort((a, b) => (orderIdx.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderIdx.get(b) ?? Number.MAX_SAFE_INTEGER));
}

// Duplicate-key guard for lookups (compound key aware)
function checkLookupDuplicates(lk) {
  if (!lk.rightId || !db.tables[lk.rightId]) return null;
  // When policy is 'combine', duplicates are expected and handled at execution time.
  if (lk.duplicatePolicy && lk.duplicatePolicy.mode === 'combine') return null;
  const pairs = _lkKeyPairs(lk);
  if (!pairs.length) return null;
  try {
    const table = quoteId(lk.rightId);
    const tname = db.tables[lk.rightId].name;
    const rightCols = pairs.map(p => p.right);
    const whereParts = rightCols
      .map(c => `${quoteId(c)} IS NOT NULL AND TRIM(${quoteId(c)}) != ''`)
    const excl = db.excludedRows?.[lk.rightId];
    if (excl && excl.size) {
      whereParts.push(`"_rowno" NOT IN (${[...excl].join(',')})`);
    }
    const whereNonNull = whereParts.join(' AND ');
    const concatExpr = rightCols.length === 1
      ? quoteId(rightCols[0])
      : rightCols.map(c => quoteId(c)).join(` || CHAR(0) || `);
    const sql = `
      SELECT COUNT(*) AS total, COUNT(DISTINCT ${concatExpr}) AS uniq
      FROM ${table}
      WHERE ${whereNonNull}
    `;
    const rows = execQuery(sql);
    if (!rows.length) return null;
    const { total, uniq } = rows[0];
    if (total > uniq) {
      const dupes = total - uniq;
      const keyLabels = rightCols.map(c => colUserLabel(lk.rightId, c) || c);
      const keyDesc = keyLabels.length === 1
        ? `"${keyLabels[0]}"`
        : keyLabels.map(c => `"${c}"`).join(' + ');
      return `${keyDesc} in "${tname}" has ${dupes.toLocaleString()} duplicate combination${dupes === 1 ? '' : 's'} — it's unclear which row's data applies when there are multiple matches. Choose columns that together form a unique key.`;
    }
    return null;
  } catch {
    return null;
  }
}

function _checkAllLookups() {
  _lookupDupErrorCache.clear();
  for (let i = 0; i < (db.lookups || []).length; i++) {
    const err = checkLookupDuplicates(db.lookups[i]);
    if (err) _lookupDupErrorCache.set(i, err);
  }
}
function removeLookup(i) {
  db.lookups.splice(i, 1);
  _afterCombineChange();
}
function selectAllLookupCols(i) {
  const lk = db.lookups[i];
  const rt = lk.rightId && db.tables[lk.rightId];
  if (rt) {
    _showLayoutAliasesForSource(lk.rightId);
    _afterCombineChange();
  }
}
function selectNoneLookupCols(i) {
  const lk = db.lookups[i];
  _hideLookupLayoutAliasesSafely(lk.rightId, null, i);
  _afterCombineChange();
}

function _afterCombineChange() {
  _checkAllLookups();
  _checkAllCalcs();
  const nowCols = projectedCols();
  if (db.selCols) {
    nowCols.forEach(c => { if (!_seenCols.has(c)) { db.selCols.add(c); _seenCols.add(c); } });
    const nowSet = new Set(nowCols);
    for (const c of [...db.selCols]) { if (!nowSet.has(c)) db.selCols.delete(c); }
  }
  if (!db.colOrder) {
    db.colOrder = [...nowCols];
  } else {
    const nowSet = new Set(nowCols);
    db.colOrder = [
      ...db.colOrder.filter(c => nowSet.has(c)),
      ...nowCols.filter(c => !db.colOrder.includes(c)),
    ];
  }
  _syncSubtotalByToLayout();
  renderQueryBuilder();
}

// ── Column picker ─────────────────────────────────────────────────────────────
function renderColChips() {
  if (!db.base) return;
  const cols   = projectedCols();
  const colMap = buildColSourceMap();
  const mode   = db.aggMode || 'none';

  if (!db.selCols) {
    db.selCols = new Set(cols);
    _seenCols  = new Set(cols);
  }

  // Build/maintain colOrder
  if (!db.colOrder) {
    db.colOrder = [...cols];
  } else {
    const colSet = new Set(cols);
    db.colOrder = [
      ...db.colOrder.filter(c => colSet.has(c)),
      ...cols.filter(c => !db.colOrder.includes(c)),
    ];
  }
  _syncSubtotalByToLayout();

  const groupSet   = new Set(db.groupBy);
  const showBadges = mode === 'group' && groupSet.size > 0;

  document.getElementById('colChips').innerHTML = db.colOrder.map(c => {
    const src      = colMap.get(c);
    const colorCls = src ? getTableColorClass(src.tid) : '';
    const label    = h(colDisplayLabel(c, colMap));

    // Skip columns hidden from the layout
    if (db.selCols instanceof Set && !db.selCols.has(c)) return '';

    let tip = '';
    if (src?.kind === 'calc') {
      const leftLabel  = colDisplayLabel(src.left, colMap);
      const rightLabel = src.right ? colDisplayLabel(src.right, colMap) : '';
      if (src.op === 'ROLLAVG') {
        const mode = src.explicitOrder ? `explicit order: ${src.orderCol || '(none)'} ${src.orderDir || 'ASC'}` : 'report sort order';
        tip = `data-tip="Calculated: rolling average of ${h(leftLabel)}&#10;Window: ${h(String(src.window || 7))}&#10;Order: ${h(mode)}"`;
      } else if (src.op === 'PCTTOTAL') {
        tip = `data-tip="Calculated: ${h(leftLabel)} as % of total&#10;Scope: current filtered set${(db.aggMode || 'none') === 'subtotals' && (db.subtotalBy || []).length ? ' (per subtotal group)' : ''}"`;
      } else {
        tip = `data-tip="Calculated: ${h(leftLabel)} ${h(src.op)} ${h(rightLabel)}"`;
      }
    } else if (src) {
      const tbl  = db.tables[src.tid];
      const vals = (tbl?.samples?.[src.col] || []).slice(0, 3);
      const from = `From: ${h(tbl?.name ?? src.tid)}`;
      tip = vals.length
        ? `data-tip="${from}&#10;Sample: ${vals.map(v => h(String(v))).join(' · ')}"`
        : `data-tip="${from}&#10;(no sample values)"`;
    }

    if (mode === 'group') {
      const isOn     = groupSet.has(c);
      const hasAgg   = db.aggregates.some(a => a.col === c);
      const isOrphan = showBadges && !isOn && !hasAgg;
      const badge    = isOrphan
        ? ` <span class="chip-warn-badge" data-autowarn="${h(c)}" title="No calculation for this column — it will be dropped from results. Click ⚠ to add one automatically.">⚠</span>`
        : '';
      return `<span class="chip ${isOn ? 'on' : ''} ${isOrphan ? 'chip-orphan' : ''} ${colorCls}" draggable="true" data-col="${h(c)}" ${tip}>${label}${badge}</span>`;
    } else if (mode === 'subtotals') {
      const isOn = (db.subtotalBy || []).includes(c);
      return `<span class="chip ${isOn ? 'on' : ''} ${colorCls}" draggable="true" data-col="${h(c)}" ${tip}>${label}</span>`;
    } else {
      const isOn = db.selCols.has(c);
      return `<span class="chip ${isOn ? 'on' : ''} ${colorCls}" draggable="true" data-col="${h(c)}" ${tip}>${label}</span>`;
    }
  }).join('');

  const btnRow = document.getElementById('colBtnRow');
  if (btnRow) btnRow.style.display = (mode === 'group' || mode === 'subtotals') ? 'none' : '';

  const hint = document.getElementById('colCardHint');
  if (hint) {
    if (mode === 'group') {
      hint.textContent = '— double-click to group by · drag to reorder';
    } else if (mode === 'subtotals') {
      hint.textContent = '— double-click to group rows · drag to reorder';
    } else {
      hint.textContent = '— double-click to show/hide · drag to reorder';
    }
  }
}

// Single-click chip — only the ⚠ orphan badge is handled here; chip clicks do nothing
document.getElementById('colChips').addEventListener('click', e => {
  const badge = e.target.closest('[data-autowarn]');
  if (badge) {
    e.stopPropagation();
    const col = badge.dataset.autowarn;
    if (!db.aggregates.some(a => a.col === col)) {
      db.aggregates.push({ fn: smartDefaultFn(col), col, alias: '', auto: true });
    }
    renderColChips();
    renderAggregateItems(projectedCols());
  }
});

// Double-click chip — toggle behavior depends on mode
document.getElementById('colChips').addEventListener('dblclick', e => {
  const chip = e.target.closest('.chip[data-col]');
  if (!chip) return;
  const col  = chip.dataset.col;
  const mode = db.aggMode || 'none';

  if (mode === 'group') {
    const idx = db.groupBy.indexOf(col);
    if (idx >= 0) {
      db.groupBy.splice(idx, 1);
      if (db.groupBy.length === 0) {
        db.aggregates = db.aggregates.filter(a => !a.auto);
      } else if (!db.aggregates.some(a => a.col === col)) {
        db.aggregates.push({ fn: smartDefaultFn(col), col, alias: '', auto: true });
      }
    } else {
      db.groupBy.push(col);
      db.aggregates = db.aggregates.filter(a => !(a.col === col && a.auto));
      const allCols = projectedCols();
      for (const c of allCols) {
        if (!db.groupBy.includes(c) && !db.aggregates.some(a => a.col === c)) {
          db.aggregates.push({ fn: smartDefaultFn(c), col: c, alias: '', auto: true });
        }
      }
    }
    renderAggregation();

  } else if (mode === 'subtotals') {
    const sb  = db.subtotalBy || (db.subtotalBy = []);
    const idx = sb.indexOf(col);
    if (idx >= 0) {
      sb.splice(idx, 1);
      delete db.subtotalFns[col];
    } else {
      sb.push(col);
    }
    _syncSubtotalByToLayout();
    renderAggregation();

  } else {
    if (!db.selCols) db.selCols = new Set(projectedCols());
    if (db.selCols.has(col)) db.selCols.delete(col);
    renderQueryBuilder();
  }
});

// Right-click chip → rename column label
document.getElementById('colChips').addEventListener('contextmenu', e => {
  const chip = e.target.closest('.chip[data-col]');
  if (!chip) return;
  e.preventDefault();
  const alias = chip.dataset.col;
  if (!renameProjectedColumn(alias)) return;
  renderQueryBuilder();
  if (db.result) renderResults(db.result);
});

// Drag-and-drop reordering
let _dragCol = null;

function _chipAtPoint(container, x, y) {
  const chips = [...container.querySelectorAll('[data-col]')]
    .filter(c => c.dataset.col !== _dragCol);
  if (!chips.length) return null;

  // 1. Cursor directly over a chip — use it immediately
  const direct = document.elementFromPoint(x, y)?.closest('[data-col]');
  if (direct && direct.dataset.col !== _dragCol) return direct;

  // 2. Chips on the same row (cursor Y falls within their bounding box)
  const sameRow = chips.filter(c => {
    const r = c.getBoundingClientRect();
    return y >= r.top && y <= r.bottom;
  });

  // 3. Among same-row chips use horizontal distance only; otherwise full Euclidean
  const pool = sameRow.length ? sameRow : chips;
  let best = null, bestDist = Infinity;
  for (const chip of pool) {
    const r  = chip.getBoundingClientRect();
    const cx = (r.left + r.right)  / 2;
    const cy = (r.top  + r.bottom) / 2;
    const d  = sameRow.length ? Math.abs(x - cx) : Math.hypot(x - cx, y - cy);
    if (d < bestDist) { bestDist = d; best = chip; }
  }
  return best;
}

document.getElementById('colChips').addEventListener('dragstart', e => {
  const chip = e.target.closest('[data-col]');
  if (!chip) return;
  _dragCol = chip.dataset.col;
  chip.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
document.getElementById('colChips').addEventListener('dragend', () => {
  _dragCol = null;
  document.querySelectorAll('#colChips .chip').forEach(c => c.classList.remove('dragging', 'drag-over'));
});
document.getElementById('colChips').addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const nearest = _chipAtPoint(e.currentTarget, e.clientX, e.clientY);
  document.querySelectorAll('#colChips .chip').forEach(c => c.classList.remove('drag-over'));
  if (nearest) nearest.classList.add('drag-over');
});
document.getElementById('colChips').addEventListener('drop', e => {
  e.preventDefault();
  const nearest = _chipAtPoint(e.currentTarget, e.clientX, e.clientY);
  if (!nearest || !_dragCol || nearest.dataset.col === _dragCol) return;
  if (!db.colOrder) db.colOrder = projectedCols();
  const from = db.colOrder.indexOf(_dragCol);
  const to   = db.colOrder.indexOf(nearest.dataset.col);
  if (from < 0 || to < 0) return;
  db.colOrder.splice(from, 1);
  db.colOrder.splice(to, 0, _dragCol);
  _syncSubtotalByToLayout();
  renderColChips();
  if ((db.aggMode || 'none') === 'subtotals') {
    const projected = projectedCols();
    const ordered = Array.isArray(db.colOrder)
      ? db.colOrder.filter(c => projected.includes(c))
      : projected;
    renderSubtotalsSection(ordered);
  }
});

function selectAllCols()  { db.selCols = new Set(projectedCols()); renderColChips(); }
function selectNoneCols() { db.selCols = new Set();                 renderColChips(); }

// ── Filters ───────────────────────────────────────────────────────────────────
const FILTER_OPS = [
  'contains', 'equals', 'not equals',
  '>', '<', '>=', '<=',
  'starts with', 'ends with',
  'is empty', 'not empty',
];
const NO_VAL_OPS = new Set(['is empty', 'not empty']);

function _populateFilterDatalist(i, alias) {
  const dl = document.getElementById('fdl_' + i);
  if (!dl || !alias) { if (dl) dl.innerHTML = ''; return; }
  const src = buildColSourceMap().get(alias);
  if (!src) return;
  try {
    const rows = execQuery(
      `SELECT DISTINCT ${quoteId(src.col)} FROM ${quoteId(src.tid)}
       WHERE ${quoteId(src.col)} IS NOT NULL
       ORDER BY ${quoteId(src.col)} LIMIT 100`
    );
    dl.innerHTML = rows.map(r => {
      const v = String(Object.values(r)[0]).trim();
      return v ? `<option value="${h(v)}">` : '';
    }).join('');
  } catch (_) {}
}

function addFilter() {
  db.filters.push({ col: '', op: 'contains', vals: [''], enabled: true });
  renderFilters();
}

function removeFilter(i) {
  db.filters.splice(i, 1);
  renderFilters();
}

function renderFilters() {
  const colMap = buildColSourceMap();
  const cols   = projectedCols().filter(c => {
    const s = colMap.get(c);
    return !(s?.kind === 'calc' && (s.op === 'ROLLAVG' || s.op === 'PCTTOTAL'));
  });
  const wrap   = document.getElementById('filterItems');

  if (!db.filters.length) {
    wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No filters — all rows returned</span>';
    return;
  }

  wrap.innerHTML = db.filters.map((f, i) => {
    const noVal = NO_VAL_OPS.has(f.op);
    const vals = Array.isArray(f.vals) ? f.vals : [''];
    const fEnabled = f.enabled !== false;
    const fV = getValidation().items[`filter_${i}`];
    const fBlocked = fV && fV.blocking;
    const fUnresolved = fV && !fV.resolved;
    const fIssueMsg = fUnresolved && fV.issues[0] ? fV.issues[0].message : null;
    const orValInputs = vals.map((v, j) => `
      ${j > 0 ? '<span style="font-size:0.7rem;color:var(--muted);padding:0 1px;flex-shrink:0">OR</span>' : ''}
      <input type="text" list="fdl_${i}" placeholder="value" value="${h(v)}"
             data-fi="${i}" data-vi="${j}" data-fp="val" style="width:120px">
      ${j > 0 ? `<button class="btn btn-danger" style="padding:2px 5px;font-size:0.75rem;flex-shrink:0" data-rmval="${j}" data-fi="${i}" title="Remove this OR value">✕</button>` : ''}
    `).join('');
    return `
    <div class="filter-row${fBlocked ? ' pl-lookup-stage--invalid' : fUnresolved && !fEnabled ? ' pl-lookup-stage--disabled-issue' : ''} ${!fEnabled ? 'pl-stage-disabled' : ''}">
      ${fIssueMsg ? `<div class="pl-lookup-error" style="width:100%;font-size:0.72rem;margin-bottom:3px">${fBlocked ? '⛔' : '⚠'} ${h(fIssueMsg)}</div>` : ''}
      <label class="pl-enable-toggle" style="margin-left:auto;order:99" title="${fEnabled ? 'Disable filter' : 'Enable filter'}"><input type="checkbox" data-fi="${i}" data-fp="enabled" ${fEnabled ? 'checked' : ''}><span class="pl-enable-label">${fEnabled ? '' : 'Off'}</span></label>
      <select data-fi="${i}" data-fp="col">
        <option value="">Column…</option>
        ${cols.map(c => `<option value="${h(c)}" ${f.col === c ? 'selected' : ''}>${h(colDisplayLabel(c, colMap))}</option>`).join('')}
      </select>
      <select class="fop" data-fi="${i}" data-fp="op">
        ${FILTER_OPS.map(op => `<option value="${op}" ${f.op === op ? 'selected' : ''}>${op}</option>`).join('')}
      </select>
      <span class="filter-or-wrap" style="display:${noVal ? 'none' : 'flex'};gap:4px;align-items:center;flex-wrap:wrap">
        ${orValInputs}
        <button class="btn btn-ghost" style="padding:2px 7px;font-size:0.76rem;flex-shrink:0" data-addorval="${i}" title="Add OR value">＋</button>
        <datalist id="fdl_${i}"></datalist>
      </span>
      <button class="btn btn-danger" data-rmf="${i}">✕</button>
    </div>`;
  }).join('');

  db.filters.forEach((f, i) => { if (f.col) _populateFilterDatalist(i, f.col); });
}

document.getElementById('filterItems').addEventListener('change', e => {
  const { fi, fp } = e.target.dataset;
  if (fi === undefined || !fp) return;
  const f = db.filters[+fi];
  if (!f) return;
  if (fp === 'enabled') {
    f.enabled = e.target.checked;
    invalidateValidation();
    renderFilters();
    return;
  }
  const i = +fi;
  if (fp === 'col') {
    f.col = e.target.value;
    f.vals = [''];
    renderFilters();
    if (f.col) _populateFilterDatalist(i, f.col);
  } else if (fp === 'op') {
    f.op = e.target.value;
    const orWrap = e.target.closest('.filter-row').querySelector('.filter-or-wrap');
    if (orWrap) orWrap.style.display = NO_VAL_OPS.has(e.target.value) ? 'none' : 'flex';
  }
});
document.getElementById('filterItems').addEventListener('input', e => {
  const { fi, vi, fp } = e.target.dataset;
  if (fi !== undefined && fp === 'val' && vi !== undefined) {
    const f = db.filters[+fi];
    if (f) {
      if (!Array.isArray(f.vals)) f.vals = [''];
      f.vals[+vi] = e.target.value;
    }
  }
});
document.getElementById('filterItems').addEventListener('click', e => {
  const rmf = e.target.closest('[data-rmf]');
  if (rmf) { removeFilter(+rmf.dataset.rmf); return; }

  const addOrBtn = e.target.closest('[data-addorval]');
  if (addOrBtn) {
    const i = +addOrBtn.dataset.addorval;
    const f = db.filters[i];
    if (!f) return;
    if (!Array.isArray(f.vals)) f.vals = [''];
    f.vals.push('');
    renderFilters();
    if (f.col) _populateFilterDatalist(i, f.col);
    return;
  }

  const rmVal = e.target.closest('[data-rmval]');
  if (rmVal) {
    const i = +rmVal.dataset.fi;
    const j = +rmVal.dataset.rmval;
    const f = db.filters[i];
    if (!f) return;
    if (!Array.isArray(f.vals)) f.vals = [''];
    if (f.vals.length <= 1) return;
    f.vals.splice(j, 1);
    renderFilters();
    if (f.col) _populateFilterDatalist(i, f.col);
    return;
  }
});

// ── Sort order ────────────────────────────────────────────────────────────────
function renderSorts() {
  const cols   = projectedCols();
  const colMap = buildColSourceMap();
  const wrap   = document.getElementById('sortItems');
  if (!wrap) return;
  if (!db.sorts.length) {
    wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No sort — rows returned in natural order</span>';
    return;
  }
  wrap.innerHTML = db.sorts.map((s, i) => {
    const sEnabled = s.enabled !== false;
    const sV = getValidation().items[`sort_${i}`];
    const sBlocked = sV && sV.blocking;
    const sUnresolved = sV && !sV.resolved;
    const sIssueMsg = sUnresolved && sV.issues[0] ? sV.issues[0].message : null;
    return `
    <div class="sort-row${sBlocked ? ' pl-lookup-stage--invalid' : sUnresolved && !sEnabled ? ' pl-lookup-stage--disabled-issue' : ''} ${!sEnabled ? 'pl-stage-disabled' : ''}">
      ${sIssueMsg ? `<div class="pl-lookup-error" style="width:100%;font-size:0.72rem;margin-bottom:3px">${sBlocked ? '⛔' : '⚠'} ${h(sIssueMsg)}</div>` : ''}
      <span class="sort-level">${i + 1}.</span>
      <select data-si="${i}" data-sp="col" style="flex:1;min-width:0">
        <option value="">— column —</option>
        ${cols.map(c => `<option value="${h(c)}" ${s.col === c ? 'selected' : ''}>${h(colDisplayLabel(c, colMap))}</option>`).join('')}
      </select>
      <select data-si="${i}" data-sp="dir" style="width:95px;flex-shrink:0">
        <option value="ASC"  ${s.dir === 'ASC'  ? 'selected' : ''}>↑ A → Z</option>
        <option value="DESC" ${s.dir === 'DESC' ? 'selected' : ''}>↓ Z → A</option>
      </select>
      <label class="pl-enable-toggle" title="${sEnabled ? 'Disable sort' : 'Enable sort'}"><input type="checkbox" data-si="${i}" data-sp="enabled" ${sEnabled ? 'checked' : ''}><span class="pl-enable-label">${sEnabled ? '' : 'Off'}</span></label>
      <button class="btn btn-danger" data-rmsort="${i}">✕</button>
    </div>`;
  }).join('');
}

function addSort() {
  db.sorts.push({ col: '', dir: 'ASC', enabled: true });
  renderSorts();
}

function removeSort(i) {
  db.sorts.splice(i, 1);
  renderSorts();
}

document.getElementById('sortItems').addEventListener('change', e => {
  const { si, sp } = e.target.dataset;
  if (si !== undefined && sp === 'enabled') {
    db.sorts[+si].enabled = e.target.checked;
    invalidateValidation();
    renderSorts();
    return;
  }
  if (si !== undefined && sp) db.sorts[+si][sp] = e.target.value;
});
document.getElementById('sortItems').addEventListener('click', e => {
  const btn = e.target.closest('[data-rmsort]');
  if (btn) removeSort(+btn.dataset.rmsort);
});

// ── Query execution ───────────────────────────────────────────────────────────
function runQuery() {
  if (!db.base || !db.tables[db.base]) return;

  // Populate error caches so validation.js can include duplicate and calc issues.
  _checkAllLookups();
  _checkAllCalcs();

  // Block on any validation issue (source refs, dup keys, calc errors, etc.).
  const v = getValidation();
  if (v.reportStatus === 'blocked') {
    const blockingItems = Object.values(v.items).filter(item => item.blocking);
    const firstMsg = blockingItems[0]?.issues[0]?.message || 'missing source data';
    toast(`Can't run — fix source issues first (${firstMsg}${blockingItems.length > 1 ? ` and ${blockingItems.length - 1} more` : ''}).`, 'err');
    return;
  }

  // Warn about incomplete lookups (they are silently skipped in engine)
  const skippedLookups = (db.lookups || []).filter(
    lk => lk.rightId && db.tables[lk.rightId] && !_lkKeyPairs(lk).length
  );
  if (skippedLookups.length) {
    const names = skippedLookups.map(lk => `"${db.tables[lk.rightId].name}"`).join(', ');
    toast(`Lookup${skippedLookups.length > 1 ? 's' : ''} skipped (match columns not set): ${names}`, 'warn');
  }

  // Guard: if not aggregating and user has deselected all columns
  const _hasAgg = db.aggMode === 'group' && (db.groupBy.length > 0 || db.aggregates.length > 0);
  if (!_hasAgg && !['totals', 'subtotals'].includes(db.aggMode) && db.selCols && db.selCols.size === 0) {
    toast('No output columns selected — click All or pick at least one column.', 'err');
    return;
  }

  const status = document.getElementById('runStatus');
  status.textContent = 'Running…';

  // Defer so the "Running…" label paints before we block on the query.
  setTimeout(() => {
    try {
      // executeReport builds a QueryPlan via query-plan.js, renders SQL via sql-renderer.js,
      // executes via execQuery, and returns a ResultSet.  This is the canonical execution path.
      const resultSet = executeReport(db);

      const displayRows = resultSet.rows.filter(r => !r._row_type);
      const hasTotals   = !!resultSet.metadata.totalsRow;
      const hasSubs     = !!resultSet.metadata.hasSubtotals;

      db.result = {
        rows:         resultSet.rows,
        totalsRow:    resultSet.metadata.totalsRow || null,
        cols:         resultSet.columns,
        hasSubtotals: hasSubs,
      };

      let statusText = displayRows.length.toLocaleString() + ' rows';
      if (hasTotals) statusText += ' + grand total';
      if (hasSubs)   statusText += ' (subtotals)';
      status.textContent = statusText;

      switchTab('results');
      renderResults(db.result);
    } catch (ex) {
      status.textContent = 'Error';
      toast('Query error: ' + ex.message, 'err');
      console.error(ex.message);
    }
  }, 20);
}

// ── Merge duplicates toggles ──────────────────────────────────────────────────
// Called after a successful run to populate the #mergeToggles section in the
// Sort & Filter card.
function renderMergeToggles(cols) {
  const wrap = document.getElementById('mergeToggles');
  if (!wrap) return;

  const ulChk = document.getElementById('chkMergeGroupUnderline');
  if (ulChk) ulChk.checked = !!db.mergeGroupUnderline;

  const baseDisplayCols = (cols || []).filter(c => c !== '_rowno' && c !== '_row_type' && c !== '_isTotalsRow');
  // Only show columns visible in the report layout
  const visibleDisplayCols = (db.selCols instanceof Set)
    ? baseDisplayCols.filter(c => db.selCols.has(c))
    : baseDisplayCols;
  const orderedFromLayout = Array.isArray(db.colOrder)
    ? db.colOrder.filter(c => visibleDisplayCols.includes(c))
    : [];
  const displayCols = [
    ...orderedFromLayout,
    ...visibleDisplayCols.filter(c => !orderedFromLayout.includes(c)),
  ];
  if (!displayCols.length) {
    wrap.innerHTML = '<span style="font-size:0.76rem;color:var(--muted)">No result columns</span>';
    return;
  }

  if (!db.mergedCols) db.mergedCols = [];
  const mergedSet = new Set(db.mergedCols);
  const colMap = buildColSourceMap();

  wrap.innerHTML = '';
  for (const c of displayCols) {
    const label = colDisplayLabel(c, colMap);
    const checked = mergedSet.has(c);

    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.76rem;font-weight:normal;margin-top:4px';

    const chk = document.createElement('input');
    chk.type    = 'checkbox';
    chk.checked = checked;
    chk.addEventListener('change', () => {
      if (chk.checked) {
        if (!db.mergedCols.includes(c)) db.mergedCols.push(c);
      } else {
        db.mergedCols = db.mergedCols.filter(x => x !== c);
      }
      // Re-render the results grid with updated merge settings
      if (db.result) renderResults(db.result);
    });

    lbl.appendChild(chk);
    lbl.appendChild(document.createTextNode(label));
    wrap.appendChild(lbl);
  }
}

function setMergeGroupUnderline(checked) {
  db.mergeGroupUnderline = !!checked;
  if (db.result) renderResults(db.result);
}
