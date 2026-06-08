import { h } from '../../core/utils.js';

export function renderTip(text: string): string {
  return `<span class="tip" data-tip="${h(text)}">?</span>`;
}
