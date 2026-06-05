'use strict';

function loadState(file) {
  const reader = new FileReader();
  reader.onload = e => {
    let payload;
    try {
      payload = JSON.parse(e.target.result);
    } catch {
      toast('Could not parse state file \u2014 is it a valid .rcjson file?', 'err');
      return;
    }

    if (!payload || typeof payload !== 'object') {
      toast('Invalid state file.', 'err');
      return;
    }

    if (payload.v !== STATE_VERSION) {
      toast(`Unsupported project file version (got ${JSON.stringify(payload.v)}, expected ${STATE_VERSION}). Load aborted.`, 'err');
      return;
    }

    const { next, brokenRefs, nextExcludedRows } = hydrateState(payload);
    applyState(next, nextExcludedRows);

    if (brokenRefs.length) {
      const summary = brokenRefs.length === 1
        ? `1 item needs attention: ${brokenRefs[0]}.`
        : `${brokenRefs.length} items need attention \u2014 missing sheets or columns. Run the report to see full details.`;
      toast(`Report setup loaded with issues \u2014 ${summary}`, 'warn');
    } else {
      toast('Report setup loaded.', 'ok');
    }
  };

  reader.onerror = () => toast('Failed to read file.', 'err');
  reader.readAsText(file);
}

(function () {
  const inp = document.createElement('input');
  inp.type   = 'file';
  inp.accept = '.rcjson';
  inp.hidden = true;
  inp.id     = 'qbsInput';
  inp.addEventListener('change', () => {
    if (inp.files[0]) loadState(inp.files[0]);
    inp.value = '';
  });
  document.body.appendChild(inp);
})();
