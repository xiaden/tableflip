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
      if (e.key === 'Escape') {
        onClose?.();
      }
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

// ── Legacy imperative API (temporary bridge until views migrate) ──

import { render } from 'preact/compat';

export interface ModalOptions {
  id?: string;
  title?: string;
  content?: string;
  buttons?: ModalButton[];
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  className?: string;
}

export interface ModalButton {
  label: string;
  action: () => void;
  className?: string;
  primary?: boolean;
}

let activeModal: HTMLElement | null = null;

export function showModal(options: ModalOptions): void {
  const {
    id = 'modal-' + Date.now(),
    title = '',
    content = '',
    buttons = [],
    onClose,
    closeOnBackdrop = true,
    className = '',
  } = options;

  if (activeModal) closeModal();

  const container = document.createElement('div');
  container.id = id;
  document.body.appendChild(container);
  activeModal = container;

  const handleClose = () => {
    closeModal();
    onClose?.();
  };

  render(
    <Modal
      open={true}
      title={title}
      onClose={handleClose}
      closeOnBackdrop={closeOnBackdrop}
      className={className}
      buttons={buttons.map(btn => ({
        label: btn.label,
        action: () => btn.action(),
        primary: btn.primary,
        className: btn.className,
      }))}
    >
      <div dangerouslySetInnerHTML={{ __html: content }} />
    </Modal>,
    container
  );
}

export function closeModal(): void {
  if (activeModal) {
    render(null, activeModal);
    activeModal.remove();
    activeModal = null;
  }
}

export function confirm(
  message: string,
  options: {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  } = {}
): void {
  const {
    title = 'Confirm',
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel,
  } = options;

  showModal({
    title,
    content: `<p>${message}</p>`,
    buttons: [
      { label: cancelLabel, action: () => { closeModal(); onCancel?.(); } },
      { label: confirmLabel, primary: true, action: () => { closeModal(); onConfirm?.(); } },
    ],
  });
}

export function alert(
  message: string,
  options: { title?: string; okLabel?: string; onOk?: () => void } = {}
): void {
  const { title = 'Alert', okLabel = 'OK', onOk } = options;

  showModal({
    title,
    content: `<p>${message}</p>`,
    buttons: [
      { label: okLabel, primary: true, action: () => { closeModal(); onOk?.(); } },
    ],
  });
}

export function isModalOpen(): boolean {
  return activeModal !== null;
}

export function getActiveModal(): HTMLElement | null {
  return activeModal;
}
