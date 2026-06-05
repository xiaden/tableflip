'use strict';

function renderPipeline(ids) {
  const pl = document.getElementById('pipeline');
  const sortedIds = ids.sort((a, b) => db.tables[a].name.localeCompare(db.tables[b].name));
  const usedAsLookup = new Set((db.lookups || []).map(l => l.rightId).filter(Boolean));
  const usedAsStack  = new Set(db.stacks || []);
  const layoutColMap = db.base && db.tables[db.base] ? buildColSourceMap() : new Map();
  const layoutMode = db.aggMode || 'none';

  const stackAvail  = sortedIds.filter(id => id !== db.base && !usedAsStack.has(id) && !usedAsLookup.has(id));
  const lookupAvail = sortedIds.filter(id => id !== db.base && !usedAsStack.has(id) && !usedAsLookup.has(id));

  let html = '';

  const stackSheetsHtml = db.base && db.tables[db.base] ? `
    <div class="pl-stack-sheets" id="plStackSheets">
      ${(db.stacks || []).filter(id => db.tables[id]).map(id => `
        <span class="pl-stack-chip" style="border-left:3px solid ${getTableColor(id)}">
          ${h(db.tables[id].name)}
          <span class="rm" data-rmstack="${id}">\u00D7</span>
        </span>`).join('')}
      ${stackAvail.length ? `
        <div class="pl-add-btn" id="plStackAddBtn">\uFF0B Include</div>
        <select class="pl-add-select" id="plStackSel" onchange="addStack(this.value)">
          <option value="">pick a sheet\u2026</option>
          ${stackAvail.map(id => `<option value="${id}">${h(db.tables[id].name)}</option>`).join('')}
        </select>` : ''}
    </div>` : '<span style="font-size:0.76rem;color:var(--muted)">\u2190 Pick a sheet first</span>';

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
          <option value="">\u2014 select a sheet \u2014</option>
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

  html += _plArrow('base');

  (db.lookups || []).forEach((lk, i) => {
    html += _plLookupStage(lk, i, sortedIds, usedAsLookup, usedAsStack, layoutColMap, layoutMode);
    html += _plArrow(`lk${i}`);
  });

  (db.calcStages || []).forEach((calc, i) => {
    html += _plCalcStage(calc, i);
    html += _plArrow(`calc${i}`);
  });

  html += `<div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;padding:2px 0 8px">
    <div class="pl-add-btn" onclick="addLookup()">\uFF0B Look up columns from another sheet</div>
    <div class="pl-add-btn" onclick="addCalcStage()">\uFF0B Add a calculated column from existing sheets</div>
  </div>`;

  pl.innerHTML = html;

  const addBtn = pl.querySelector('#plStackAddBtn');
  const addSel = pl.querySelector('#plStackSel');
  if (addBtn && addSel) {
    addBtn.addEventListener('click', () => {
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

  pl.querySelectorAll('[data-rmstack]').forEach(el => {
    el.addEventListener('click', () => removeStack(el.dataset.rmstack));
  });
  pl.querySelectorAll('[data-rmlookup]').forEach(el => {
    el.addEventListener('click', () => removeLookup(+el.dataset.rmlookup));
  });
  pl.querySelectorAll('[data-rmcalc]').forEach(el => {
    el.addEventListener('click', () => removeCalcStage(+el.dataset.rmcalc));
  });
  pl.querySelectorAll('[data-rmlkp]').forEach(el => {
    el.addEventListener('click', () => {
      const lk = db.lookups[+el.dataset.li];
      if (!lk || !Array.isArray(lk.keyPairs) || lk.keyPairs.length <= 1) return;
      lk.keyPairs.splice(+el.dataset.lkp, 1);
      _afterCombineChange();
    });
  });
  pl.querySelectorAll('[data-addlkp]').forEach(el => {
    el.addEventListener('click', () => {
      const lk = db.lookups[+el.dataset.addlkp];
      if (!lk) return;
      if (!Array.isArray(lk.keyPairs)) lk.keyPairs = [];
      lk.keyPairs.push({ left: '', right: '' });
      _afterCombineChange();
    });
  });
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
  pl.querySelectorAll('[data-ci]').forEach(el => {
    el.addEventListener('change', e => {
      const i    = +e.target.dataset.ci;
      const cp   = e.target.dataset.cp;
      const condIdx = e.target.dataset.cond;
      if (!cp) return;
      const c = db.calcStages?.[i];
      if (!c) return;
      if (condIdx !== undefined) {
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
    if (el.tagName === 'INPUT' && el.dataset.cond !== undefined && el.dataset.cp === 'val') {
      el.addEventListener('input', e => {
        const i = +e.target.dataset.ci;
        const j = +e.target.dataset.cond;
        const c = db.calcStages?.[i];
        if (!c || !Array.isArray(c.conditions) || !c.conditions[j]) return;
        c.conditions[j].val = e.target.value;
      });
    }
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
  pl.querySelector('[data-bc-all]')?.addEventListener('click', () => {
    _showLayoutAliasesForSource(db.base);
    _afterCombineChange();
  });
  pl.querySelector('[data-bc-none]')?.addEventListener('click', () => {
    _hideLayoutAliasesForSource(db.base);
    _afterCombineChange();
  });
  pl.querySelectorAll('[data-lk-all]').forEach(el => {
    el.addEventListener('click', () => selectAllLookupCols(+el.dataset.lkAll));
  });
  pl.querySelectorAll('[data-lk-none]').forEach(el => {
    el.addEventListener('click', () => selectNoneLookupCols(+el.dataset.lkNone));
  });
  pl.querySelectorAll('[data-preview]').forEach(el => {
    el.addEventListener('click', () => togglePreview(el.dataset.preview));
  });
}

function _plArrow(key) {
  const isOpen = _previewOpen.has(key);
  return `<div class="pl-arrow">
    <div class="pl-arrow-line"></div>
    <div class="pl-arrow-meta">
      <button class="pl-preview-btn" data-preview="${key}">${isOpen ? '\u25B2 Hide preview' : '\u25BC Preview'}</button>
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

  const sheetOpts = sortedIds
    .filter(id => id !== db.base && (!usedAsLookup.has(id) || id === lk.rightId) && !usedAsStack.has(id))
    .map(id => `<option value="${id}" ${lk.rightId === id ? 'selected' : ''}>${h(db.tables[id].name)}</option>`)
    .join('');

  const lkColorCls = lk.rightId ? getTableColorClass(lk.rightId) : '';
  const lkColMap   = buildColSourceMap();
  const leftOptsFor  = val => leftCols.map(c =>
    `<option value="${h(c)}" ${val === c ? 'selected' : ''}>${h(colDisplayLabel(c, lkColMap))}</option>`).join('');
  const rightOptsFor = val => rightCols.map(c =>
    `<option value="${h(c)}" ${val === c ? 'selected' : ''}>${h(`${db.tables[lk.rightId]?.name || lk.rightId} \u2192 ${colUserLabel(lk.rightId, c)}`)}</option>`).join('');

  const keyPairsHTML = pairs.map((pair, pi) => `
    <div class="pl-key-pair">
      <span class="pl-key-pair-label">${pi === 0 ? 'Where' : 'AND'}</span>
      <select data-li="${i}" data-lkp="${pi}" data-lp="kpLeft">
        <option value="">\u2014 column \u2014</option>${leftOptsFor(pair.left)}
      </select>
      <span class="pl-lookup-eq">=</span>
      <select data-li="${i}" data-lkp="${pi}" data-lp="kpRight">
        <option value="">\u2014 column \u2014</option>${rightOptsFor(pair.right)}
      </select>
      ${pairs.length > 1 ? `<button class="pl-rm-kp" data-rmlkp="1" data-li="${i}" data-lkp="${pi}" title="Remove this condition">\u2715</button>` : ''}
    </div>`).join('');

  const colChips = rt ? rt.cols.map(c => {
    const isLayoutVisible = _isSourceVisibleInLayout(lk.rightId, c, layoutColMap, layoutMode);
    return `<span class="pl-col-chip on ${isLayoutVisible ? '' : 'pl-col-chip-layout-hidden'} ${lkColorCls}" data-li="${i}" data-lcc="${h(c)}" ${_sampleTipFor(lk.rightId, c, ['Click to show/hide this lookup column in the report layout.'])}>${h(colUserLabel(lk.rightId, c))}</span>`;
  }).join('') : '';

  const lkEnabled = lk.enabled !== false;
  const lkV = getValidation().items[`lookup_${i}`];
  const lkVBlocked = lkV && lkV.blocking;
  const lkVUnresolved = lkV && !lkV.resolved;
  const lkVMsg = lkVUnresolved && lkV.issues[0] ? lkV.issues[0].message : null;

  return `<div class="pl-lookup-stage${lkVBlocked ? ' pl-lookup-stage--invalid' : lkVUnresolved && !lkEnabled ? ' pl-lookup-stage--disabled-issue' : ''} ${!lkEnabled ? 'pl-stage-disabled' : ''}">
    <div class="pl-stage-label">Look up columns from <span class="tip" data-tip="Pull columns from another sheet by matching a shared value \u2014 like VLOOKUP. Use '+ AND' to match on multiple columns at once.">?</span>
      <label class="pl-enable-toggle" title="${lkEnabled ? 'Disable this lookup (won\'t block report)' : 'Enable this lookup'}"><input type="checkbox" data-li="${i}" data-lp="enabled" ${lkEnabled ? 'checked' : ''}><span class="pl-enable-label">${lkEnabled ? 'Enabled' : 'Disabled'}</span></label>
    </div>
    ${lkVMsg ? `<div class="pl-lookup-error">${lkVBlocked ? '\u26D4' : '\u26A0'} ${h(lkVMsg)}</div>` : ''}
    <div class="pl-lookup-header">
      <select data-li="${i}" data-lp="rightId">
        <option value="">\u2014 pick a sheet \u2014</option>
        ${sheetOpts}
      </select>
      <button class="btn btn-danger" style="flex-shrink:0" data-rmlookup="${i}">\u2715</button>
    </div>
    ${rt ? `
    <div class="pl-lookup-keys">
      ${keyPairsHTML}
      <button class="btn btn-ghost pl-add-kp" data-addlkp="${i}">\uFF0B AND \u2026</button>
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

  const trueDisplay  = calc.customTF && String(calc.trueVal  ?? '').trim() !== '' ? h(String(calc.trueVal))  : '1';
  const falseDisplay = calc.customTF && String(calc.falseVal ?? '').trim() !== '' ? h(String(calc.falseVal)) : '0';
  const condModeText = compareMode === 'OR' ? 'any condition is' : 'all conditions are';

  const conditionsHtml = isCompare ? `
    ${conditions.map((cond, j) => `
    <div class="pl-key-pair" style="margin-top:${j === 0 ? '6px' : '4px'}">
      <span class="pl-key-pair-label">${j === 0 ? 'Where' : compareMode}</span>
      <select data-ci="${i}" data-cond="${j}" data-cp="col" style="min-width:160px">
        <option value="">\u2014 column \u2014</option>${colOptsFor(cond.col || '')}
      </select>
      <select data-ci="${i}" data-cond="${j}" data-cp="op" style="width:62px;flex-shrink:0">
        ${condOptsFor(cond.op || '=')}
      </select>
      <input type="text" data-ci="${i}" data-cond="${j}" data-cp="val" placeholder="value" value="${h(cond.val || '')}" style="min-width:110px">
      ${conditions.length > 1 ? `<button class="btn btn-danger" style="flex-shrink:0" data-rmcond="${j}" data-ci="${i}" title="Remove this condition">\u2715</button>` : ''}
    </div>`).join('')}
    <div style="margin-top:5px">
      ${conditions.length <= 1 ? `
      <button class="btn btn-ghost" style="font-size:0.76rem;padding:3px 8px" data-addcond="${i}" data-cm="AND">\uFF0B AND \u2026</button>
      <button class="btn btn-ghost" style="font-size:0.76rem;padding:3px 8px" data-addcond="${i}" data-cm="OR">\uFF0B OR \u2026</button>
      ` : `
      <button class="btn btn-ghost" style="font-size:0.76rem;padding:3px 8px" data-addcond="${i}" data-cm="${compareMode}">\uFF0B ${compareMode} \u2026</button>
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
    ${calcVMsg ? `<div class="pl-lookup-error">${calcVBlocked ? '\u26D4' : '\u26A0'} ${h(calcVMsg)}</div>` : ''}
    <div class="pl-lookup-header" style="gap:8px;flex-wrap:wrap">
      <input type="text" data-ci="${i}" data-cp="alias" placeholder="Output column name (e.g. Remaining to Ship)" value="${h(calc.alias || '')}" style="flex:1;min-width:180px">
      <button class="btn btn-danger" style="flex-shrink:0" data-rmcalc="${i}">\u2715</button>
    </div>
    ${alias ? `<div class="pl-lookup-cols" style="margin-top:6px">
      <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0;align-self:center">Output:</span>
      <span class="pl-col-chip ${_isAliasVisibleInLayout(alias, db.aggMode || 'none') ? 'on' : ''}" data-ci="${i}" data-ccc="${h(alias)}">${h(colDisplayLabel(alias, colMap))}</span>
    </div>` : ''}
    <div class="pl-key-pair" style="margin-top:8px">
      ${isCompare ? '' : `<span class="pl-key-pair-label">Formula</span>
      <select data-ci="${i}" data-cp="left" style="min-width:190px">
        <option value="">\u2014 source column \u2014</option>${leftOpts}
      </select>`}
      <select data-ci="${i}" data-cp="op" style="width:${isCompare ? '120px' : '100px'};flex-shrink:0">
        <option value="+" ${op === '+' ? 'selected' : ''}>+</option>
        <option value="-" ${op === '-' ? 'selected' : ''}>\u2212</option>
        <option value="*" ${op === '*' ? 'selected' : ''}>\u00D7</option>
        <option value="/" ${op === '/' ? 'selected' : ''}>\u00F7</option>
        <option value="ROLLAVG" ${op === 'ROLLAVG' ? 'selected' : ''}>Rolling Avg</option>
        <option value="PCTTOTAL" ${op === 'PCTTOTAL' ? 'selected' : ''}>% of Total</option>
        <option value="COMPARE" ${op === 'COMPARE' ? 'selected' : ''}>Compare\u2026</option>
      </select>
      ${isArithmetic ? `<select data-ci="${i}" data-cp="right" style="min-width:190px">
        <option value="">\u2014 compare with column \u2014</option>${rightOpts}
      </select>` : ''}
      ${isRolling ? `<span class="pl-key-pair-label" style="margin-left:6px">Window</span>
      <input type="number" min="1" step="1" value="${windowVal}" data-ci="${i}" data-cp="window" style="width:86px;flex-shrink:0">
      <label style="display:flex;align-items:center;gap:6px;font-size:0.76rem;color:var(--muted)" title="When off, rolling uses the report Sort settings.">
        <input type="checkbox" data-ci="${i}" data-cp="explicitOrder" ${explicitOrder ? 'checked' : ''}> Use explicit order
      </label>
      ${explicitOrder ? `<select data-ci="${i}" data-cp="orderCol" style="min-width:190px">
        <option value="">\u2014 explicit order column \u2014</option>${orderOpts}
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
