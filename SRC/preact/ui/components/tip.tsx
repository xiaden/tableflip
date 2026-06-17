import Tooltip from '@mui/material/Tooltip';

/** Props for the Tip component. */
export interface TipProps {
  /** Tooltip text shown on hover. Supports newlines for multi-line tips. */
  text: string;
}

/**
 * Small circular "?" icon that shows a tooltip on hover.
 *
 * Wraps MUI Tooltip around a styled inline span. Used throughout the UI to provide
 * contextual help next to section headings and labels.
 */
export function Tip({ text }: TipProps) {
  return (
    <Tooltip title={text} arrow>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 15, height: 15, borderRadius: '50%',
        background: 'var(--bg3)', border: '1px solid var(--border)',
        color: 'var(--muted)', fontSize: '0.62rem', fontWeight: 700,
        cursor: 'default', flexShrink: 0, verticalAlign: 'middle',
        marginLeft: 4, userSelect: 'none',
      }}>?</span>
    </Tooltip>
  );
}
