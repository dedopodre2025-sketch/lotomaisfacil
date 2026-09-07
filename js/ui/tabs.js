/**
 * js/ui/tabs.js
 * Gerenciamento de abas com ARIA completo (WAI-ARIA Tabs Pattern).
 * Extraído de index.html (F1.6) — versão definitiva.
 *
 * Atributos gerenciados:
 *   tablist  → role="tablist"
 *   tab btn  → role="tab", aria-selected, aria-controls, tabindex
 *   panel    → role="tabpanel", aria-labelledby, tabindex, hidden
 *
 * Suporta navegação por teclado: ← → Home End (dentro do tablist).
 *
 * Uso (F1.8 em diante):
 *   import { initTabs, switchTab } from '../ui/tabs.js';
 *
 *   initTabs({
 *     tablistEl: document.querySelector('nav[role="tablist"]'),
 *     tabs: [
 *       { id: 'simulador',  label: 'Simulador'     },
 *       { id: 'meus-jogos', label: 'Meus Jogos', onActivate: renderSavedGames },
 *       ...
 *     ],
 *     initial: 'simulador',
 *   });
 */

// ─── Estado interno ────────────────────────────────────────────────────────

/** @type {string[]} IDs das abas registradas em ordem */
let _tabIds = [];

/** @type {Map<string, function|null>} Callbacks por aba */
const _onActivate = new Map();

/** @type {string} ID da aba activa */
let _active = '';

// ─── API pública ───────────────────────────────────────────────────────────

/**
 * Inicializa o sistema de abas.
 * Configura role/aria em todos os botões e painéis e ativa a aba inicial.
 *
 * @param {object}    opts
 * @param {HTMLElement} opts.tablistEl      - Elemento contêiner dos botões (recebe role="tablist")
 * @param {Array<{id:string, onActivate?:function}>} opts.tabs - Definição das abas
 * @param {string}    [opts.initial]        - ID da aba a abrir inicialmente
 */
export function initTabs({ tablistEl, tabs, initial }) {
  tablistEl.setAttribute('role', 'tablist');
  tablistEl.setAttribute('aria-label', 'Navegação principal');

  _tabIds = tabs.map(t => t.id);
  _onActivate.clear();
  tabs.forEach(t => _onActivate.set(t.id, t.onActivate ?? null));

  // Configura atributos ARIA iniciais em botões e painéis
  _tabIds.forEach(id => {
    const btn   = document.getElementById(`btn-tab-${id}`);
    const panel = document.getElementById(`tab-${id}`);

    if (btn) {
      btn.setAttribute('role',         'tab');
      btn.setAttribute('aria-controls', `tab-${id}`);
      btn.setAttribute('aria-selected', 'false');
      btn.setAttribute('tabindex',      '-1');
    }
    if (panel) {
      panel.setAttribute('role',            'tabpanel');
      panel.setAttribute('aria-labelledby', `btn-tab-${id}`);
      panel.setAttribute('tabindex',        '0');
    }
  });

  // Navegação por teclado ← → Home End
  tablistEl.addEventListener('keydown', _onKeyDown);

  switchTab(initial ?? _tabIds[0]);
}

/**
 * Ativa uma aba pelo ID, atualizando classes CSS, ARIA e chamando o callback.
 *
 * @param {string} tabId - ID da aba (ex: 'simulador')
 */
export function switchTab(tabId) {
  _tabIds.forEach(id => {
    const btn   = document.getElementById(`btn-tab-${id}`);
    const panel = document.getElementById(`tab-${id}`);
    const isActive = id === tabId;

    if (panel) panel.classList.toggle('hidden', !isActive);

    if (btn) {
      const wasConexoes = id === 'conexoes';
      // Remove todos os modificadores de active antes de aplicar
      btn.classList.remove('active', 'active-conexoes');
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.setAttribute('tabindex',      isActive ? '0'    : '-1');

      if (isActive) {
        btn.classList.add('active');
        if (wasConexoes) btn.classList.add('active-conexoes');
      }
    }
  });

  _active = tabId;

  const cb = _onActivate.get(tabId);
  if (cb) cb();
}

// ─── Interno ───────────────────────────────────────────────────────────────

/**
 * Navega entre abas com teclado (WAI-ARIA Tabs Pattern §3.5).
 * @param {KeyboardEvent} e
 */
function _onKeyDown(e) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;

  const idx = _tabIds.indexOf(_active);
  if (idx === -1) return;

  e.preventDefault();

  let next;
  if (e.key === 'ArrowRight') next = (idx + 1) % _tabIds.length;
  else if (e.key === 'ArrowLeft') next = (idx - 1 + _tabIds.length) % _tabIds.length;
  else if (e.key === 'Home') next = 0;
  else next = _tabIds.length - 1;

  switchTab(_tabIds[next]);
  document.getElementById(`btn-tab-${_tabIds[next]}`)?.focus();
}

