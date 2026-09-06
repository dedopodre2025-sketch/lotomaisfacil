/**
 * js/ui/toast.js
 * Notificações não-bloqueantes (toast).
 * Extraído de index.html (F1.4) — versão definitiva de showToast.
 *
 * Uso:
 *   import { showToast } from '../ui/toast.js';
 *   showToast('Salvo!', 'success');
 */

/** @type {Record<string, string>} */
const COLORS = {
  info:    '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
  warning: '#f59e0b',
};

/**
 * Exibe uma notificação toast não-bloqueante no canto inferior direito.
 * Remove-se automaticamente após `duration` ms com fade-out.
 *
 * @param {string} msg       - Texto da notificação
 * @param {'info'|'success'|'error'|'warning'} [type='info'] - Tipo visual
 * @param {number} [duration=3500] - Tempo de exibição em ms antes do fade
 */
export function showToast(msg, type = 'info', duration = 3500) {
  const bg = COLORS[type] ?? COLORS.info;
  const t  = document.createElement('div');
  t.textContent = msg;
  t.setAttribute('role', 'status');
  t.setAttribute('aria-live', 'polite');
  t.style.cssText = [
    'position:fixed',
    'bottom:24px',
    'right:24px',
    'z-index:9999',
    'padding:12px 18px',
    'border-radius:8px',
    'color:#fff',
    'font-size:14px',
    'font-weight:600',
    `background:${bg}`,
    'box-shadow:0 4px 12px rgba(0,0,0,.2)',
    'transition:opacity .4s',
    'max-width:360px',
    'line-height:1.4',
  ].join(';');

  document.body.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 400);
  }, duration);
}
