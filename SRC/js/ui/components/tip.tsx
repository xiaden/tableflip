export interface TipProps {
  text: string;
}

export function Tip({ text }: TipProps) {
  return <span class="tip" data-tip={text}>?</span>;
}

// Legacy HTML string helper (temporary bridge until views migrate)
export function renderTip(text: string): string {
  return `<span class="tip" data-tip="${text}">?</span>`;
}
