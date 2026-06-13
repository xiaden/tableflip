export interface TipProps {
  text: string;
}

export function Tip({ text }: TipProps) {
  return <span class="tip" data-tip={text}>?</span>;
}
