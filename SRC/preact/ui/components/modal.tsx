import { createPortal } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

export interface ModalProps {
  open: boolean;
  title?: string;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  className?: string;
  children?: ComponentChildren;
  buttons?: { label: string; action: () => void; primary?: boolean; className?: string }[];
}

export function Modal({
  open,
  title = '',
  onClose,
  closeOnBackdrop = true,
  className = '',
  children,
  buttons = [],
}: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const btn = contentRef.current?.querySelector('button');
    if (btn) btn.focus();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div class={`modal ${className}`} role="dialog" aria-modal="true">
      {closeOnBackdrop && <div class="modal-backdrop" onClick={onClose} />}
      <div class="modal-content" ref={contentRef}>
        {title && <div class="modal-title">{title}</div>}
        <div class="modal-body">{children}</div>
        {buttons.length > 0 && (
          <div class="modal-buttons">
            {buttons.map((btn, i) => (
              <button
                key={i}
                class={['btn', btn.primary ? 'btn-primary' : 'btn-ghost', btn.className || ''].filter(Boolean).join(' ')}
                onClick={btn.action}
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
