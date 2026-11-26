import { t } from '../i18n';

/**
 * Внутриигровые тосты и модальные окна (вместо alert/confirm/prompt).
 */

export type ToastKind = 'info' | 'good' | 'bad' | 'gold';

const MAX_TOASTS = 4;

export function toast(msg: string, kind: ToastKind = 'info', ms = 2600): void {
  const root = document.getElementById('toast-root');
  if (!root) return;
  while (root.children.length >= MAX_TOASTS) root.firstElementChild?.remove();
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  root.appendChild(el);
  window.setTimeout(() => {
    el.classList.add('is-out');
    window.setTimeout(() => el.remove(), 320);
  }, ms);
}

export interface ModalButton {
  label: string;
  kind?: 'primary' | 'gold' | 'ghost' | 'danger' | 'default';
  onClick?: () => void;
  /** Закрывать модалку после нажатия (по умолчанию да) */
  close?: boolean;
  id?: string;
}

export interface ModalOptions {
  title: string;
  html?: string;
  buttons?: ModalButton[];
  dismissible?: boolean;
  onClose?: () => void;
  wide?: boolean;
}

export interface ModalHandle {
  el: HTMLElement;
  close(): void;
}

let openCount = 0;
export function isModalOpen(): boolean {
  return openCount > 0;
}

export function openModal(o: ModalOptions): ModalHandle {
  const root = document.getElementById('modal-root')!;
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  const box = document.createElement('div');
  box.className = 'modal glass scroll-y';
  if (o.wide) box.style.width = 'min(560px, 100%)';
  box.innerHTML = `
    <div class="font-display text-xl font-extrabold tracking-wide text-white mb-3">${o.title}</div>
    <div class="modal-body text-sm text-slate-300 leading-relaxed">${o.html ?? ''}</div>
    <div class="modal-buttons flex flex-wrap gap-2 justify-end mt-5"></div>`;
  back.appendChild(box);
  root.appendChild(back);
  openCount++;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openCount = Math.max(0, openCount - 1);
    back.remove();
    window.removeEventListener('keydown', onKey, true);
    o.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape' && o.dismissible !== false) {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  if (o.dismissible !== false) {
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back) close();
    });
  }
  const btnRow = box.querySelector('.modal-buttons')!;
  for (const b of o.buttons ?? []) {
    const el = document.createElement('button');
    const kind = b.kind ?? 'default';
    el.className = `btn ${kind === 'default' ? '' : 'btn-' + kind}`;
    el.style.padding = '10px 16px';
    el.style.fontSize = '14px';
    el.textContent = b.label;
    if (b.id) el.id = b.id;
    el.addEventListener('click', () => {
      b.onClick?.();
      if (b.close !== false) close();
    });
    btnRow.appendChild(el);
  }
  return { el: box, close };
}

export function confirmModal(title: string, text: string, confirmLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    openModal({
      title,
      html: `<p>${text}</p>`,
      buttons: [
        { label: t('cancel'), kind: 'ghost' },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => (result = true) },
      ],
      onClose: () => resolve(result),
    });
  });
}

/** Симуляция rewarded-рекламы для запуска без SDK: 3 секунды ожидания */
export function adSimulation(): Promise<boolean> {
  return new Promise((resolve) => {
    let granted = false;
    let left = 3;
    const m = openModal({
      title: t('adBreak'),
      html: `
        <div class="flex flex-col items-center gap-3 py-2">
          <div class="w-full h-32 rounded-xl flex items-center justify-center font-display text-3xl font-extrabold"
               style="background:linear-gradient(135deg,#00f0ff22,#f59e0b33);border:1px solid #2a3048">
            CLUTCH<span class="text-neon ml-2">AD</span>
          </div>
          <div class="text-slate-400 text-xs text-center">${t('adSimDesc')}</div>
          <div class="ad-count font-display text-lg text-gold">${t('adSkip', { n: left })}</div>
        </div>`,
      buttons: [{ label: t('cancel'), kind: 'ghost' }],
      dismissible: false,
      onClose: () => {
        window.clearInterval(timer);
        resolve(granted);
      },
    });
    const counter = m.el.querySelector('.ad-count') as HTMLElement;
    const timer = window.setInterval(() => {
      left--;
      if (left > 0) {
        counter.textContent = t('adSkip', { n: left });
      } else {
        granted = true;
        m.close();
      }
    }, 1000);
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
