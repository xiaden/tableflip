// Modal component for dialogs and overlays

import { h } from '../../core/utils.js';
import { $, require$ } from '../utils/dom.js';

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

/**
 * Show a modal dialog
 */
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

  // Close any existing modal
  if (activeModal) {
    closeModal();
  }

  const modal = document.createElement('div');
  modal.id = id;
  modal.className = `modal ${className}`;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const titleHtml = title ? `<div class="modal-title">${h(title)}</div>` : '';
  const buttonsHtml = buttons.length
    ? `<div class="modal-buttons">
        ${buttons.map((btn, i) => {
          const classes = ['btn', btn.primary ? 'btn-primary' : 'btn-ghost', btn.className || ''].filter(Boolean).join(' ');
          return `<button class="${classes}" data-btn-index="${i}">${h(btn.label)}</button>`;
        }).join('')}
       </div>`
    : '';

  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-content">
      ${titleHtml}
      <div class="modal-body">${content}</div>
      ${buttonsHtml}
    </div>
  `;

  document.body.appendChild(modal);
  activeModal = modal;

  // Setup event listeners
  const backdrop = modal.querySelector('.modal-backdrop') as HTMLElement;
  if (closeOnBackdrop && backdrop) {
    backdrop.addEventListener('click', () => {
      closeModal();
      onClose?.();
    });
  }

  // Setup button listeners
  buttons.forEach((btn, i) => {
    const button = modal.querySelector(`[data-btn-index="${i}"]`) as HTMLElement;
    if (button) {
      button.addEventListener('click', () => {
        btn.action();
      });
    }
  });

  // Focus first button or modal
  const firstButton = modal.querySelector('button') as HTMLElement;
  if (firstButton) {
    firstButton.focus();
  } else {
    modal.focus();
  }

  // Handle escape key
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal();
      onClose?.();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

/**
 * Close the active modal
 */
export function closeModal(): void {
  if (activeModal) {
    activeModal.remove();
    activeModal = null;
  }
}

/**
 * Show a confirmation dialog
 */
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
    content: `<p>${h(message)}</p>`,
    buttons: [
      {
        label: cancelLabel,
        action: () => {
          closeModal();
          onCancel?.();
        },
      },
      {
        label: confirmLabel,
        primary: true,
        action: () => {
          closeModal();
          onConfirm?.();
        },
      },
    ],
  });
}

/**
 * Show an alert dialog
 */
export function alert(
  message: string,
  options: {
    title?: string;
    okLabel?: string;
    onOk?: () => void;
  } = {}
): void {
  const {
    title = 'Alert',
    okLabel = 'OK',
    onOk,
  } = options;

  showModal({
    title,
    content: `<p>${h(message)}</p>`,
    buttons: [
      {
        label: okLabel,
        primary: true,
        action: () => {
          closeModal();
          onOk?.();
        },
      },
    ],
  });
}

/**
 * Check if a modal is currently open
 */
export function isModalOpen(): boolean {
  return activeModal !== null;
}

/**
 * Get the active modal element
 */
export function getActiveModal(): HTMLElement | null {
  return activeModal;
}
