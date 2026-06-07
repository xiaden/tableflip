import { toast } from './utils.js';
import { isRecognizableConfig, STATE_VERSION } from './state-schema.js';
import { hydrateState, applyState } from './state-hydrator.js';

export function loadState(file) {
  const reader = new FileReader();
  reader.onload = e => {
    let payload;
    try {
      payload = JSON.parse(e.target.result);
    } catch {
      toast('Could not parse state file \u2014 is it a valid .rcjson file?', 'err');
      return;
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      toast('Invalid state file.', 'err');
      return;
    }

    if (!isRecognizableConfig(payload)) {
      toast('File does not appear to be a TableFlip report configuration.', 'err');
      return;
    }

    if (payload.v !== STATE_VERSION) {
      toast(`Version mismatch (saved: ${JSON.stringify(payload.v)}, app: ${STATE_VERSION}). Loaded with best-effort \u2014 check items for issues.`, 'warn');
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

window.loadState = loadState;

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
