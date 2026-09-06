/**
 * js/ui/modal.js
 * Modais de confirmação e alerta — substitui confirm() e alert() nativos.
 * Extraído de index.html (F1.4) — versão definitiva.
 *
 * Uso:
 *   import { showConfirmModal } from '../ui/modal.js';
 *   showConfirmModal('Deseja prosseguir?', () => { ... });
 *
 * O módulo é auto-suficiente: injeta o elemento #confirm-modal no DOM
 * na primeira chamada caso ele ainda não exista (permite remover o bloco
 * estático do index.html em F1.8).
 */

const MODAL_ID  = 'confirm-modal';
const MSG_ID    = 'confirm-modal-msg';
const OK_ID     = 'confirm-modal-ok';
const CANCEL_ID = 'confirm-modal-cancel';

/**
 * Garante que o elemento overlay do modal existe no DOM.
 * Cria-o dinamicamente se não encontrado.
 */
function ensureModalDOM() {
  if (document.getElementById(MODAL_ID)) return;

  const overlay = document.createElement('div');
  overlay.id = MODAL_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', MSG_ID);
  overlay.style.cssText = [
    'display:none',
    'position:fixed',
    'inset:0',
    'z-index:10000',
    'background:rgba(0,0,0,.55)',
    'align-items:center',
    'justify-content:center',
  ].join(';');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:28px 32px;max-width:480px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.25);font-family:inherit">
      <p id="${MSG_ID}" style="margin:0 0 24px;font-size:15px;color:#1e293b;line-height:1.55"></p>
      <div style="display:flex;justify-content:flex-end;gap:12px">
        <button id="${CANCEL_ID}"
          style="padding:9px 20px;border-radius:8px;border:1px solid #cbd5e1;background:#f8fafc;color:#475569;font-weight:600;cursor:pointer;font-size:14px">
          Cancelar
        </button>
        <button id="${OK_ID}"
          style="padding:9px 20px;border-radius:8px;border:none;background:#ef4444;color:#fff;font-weight:700;cursor:pointer;font-size:14px">
          Confirmar
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
}

/**
 * Exibe um modal de confirmação não-bloqueante.
 * Chama `onConfirm` apenas se o usuário clicar em "Confirmar".
 * Clicar em "Cancelar" ou fora do card fecha sem executar nada.
 *
 * @param {string}   message    - Mensagem de aviso exibida no modal
 * @param {function} onConfirm  - Callback executado ao confirmar
 * @param {object}   [opts]
 * @param {string}   [opts.labelOk='Confirmar']     - Rótulo do botão de ação
 * @param {string}   [opts.labelCancel='Cancelar']  - Rótulo do botão de cancelar
 * @param {string}   [opts.colorOk='#ef4444']       - Cor de fundo do botão de ação
 */
export function showConfirmModal(message, onConfirm, opts = {}) {
  ensureModalDOM();

  const overlay = document.getElementById(MODAL_ID);
  const msgEl   = document.getElementById(MSG_ID);
  const btnOk   = document.getElementById(OK_ID);
  const btnCancel = document.getElementById(CANCEL_ID);

  msgEl.textContent  = message;
  btnOk.textContent     = opts.labelOk     ?? 'Confirmar';
  btnCancel.textContent = opts.labelCancel ?? 'Cancelar';
  btnOk.style.background = opts.colorOk   ?? '#ef4444';

  overlay.style.display = 'flex';

  const close = () => {
    overlay.style.display = 'none';
    btnOk.onclick     = null;
    btnCancel.onclick = null;
    overlay.onclick   = null;
  };

  btnOk.onclick     = () => { close(); onConfirm(); };
  btnCancel.onclick = () => close();

  // Fechar ao clicar no overlay escuro (fora do card)
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
}
