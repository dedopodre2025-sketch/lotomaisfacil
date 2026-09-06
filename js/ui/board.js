/**
 * js/ui/board.js
 * Volante interativo Lotofácil (1–25).
 * Extraído de index.html (F1.5) — versão definitiva.
 *
 * Mudança chave em relação ao index.html original:
 *   <div class="ball"> → <button type="button" class="ball"> com ARIA completo
 *   aria-label="Número 01" + aria-pressed="true|false"
 *
 * Uso (F1.8 em diante):
 *   import { initBoard, getSelectedNumbers, setSelectedNumbers, clearBoard } from '../ui/board.js';
 *   initBoard(document.getElementById('board'), { max: 15, onToggle: (nums) => updateAnalysis() });
 */

// ─── Estado interno do módulo ──────────────────────────────────────────────

/** @type {Set<number>} */
const _selected = new Set();

/** @type {number} */
let _maxPick = 15;

/** @type {((nums: number[]) => void) | null} */
let _onToggle = null;

// ─── API pública ───────────────────────────────────────────────────────────

/**
 * Inicializa o volante no elemento `containerEl`, criando 25 botões (1–25).
 * Usa `<button>` com `aria-label` e `aria-pressed` para acessibilidade.
 *
 * @param {HTMLElement} containerEl - Elemento `#board` que receberá os botões
 * @param {object}      [opts]
 * @param {number}      [opts.max=15]      - Máximo de dezenas selecionáveis
 * @param {function}    [opts.onToggle]    - Chamado com array ordenado ao selecionar/desmarcar
 */
export function initBoard(containerEl, opts = {}) {
  _maxPick  = opts.max      ?? 15;
  _onToggle = opts.onToggle ?? null;

  containerEl.innerHTML = '';

  for (let i = 1; i <= 25; i++) {
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.id        = `num-${i}`;
    btn.className = 'ball bg-white h-12 sm:h-14 flex items-center justify-center rounded-2xl font-black text-lg shadow-sm border-gray-100';
    btn.setAttribute('aria-label',   `Número ${String(i).padStart(2, '0')}`);
    btn.setAttribute('aria-pressed', 'false');

    // Número visível
    const numSpan = document.createElement('span');
    numSpan.className   = 'ball-num';
    numSpan.textContent = String(i).padStart(2, '0');

    // Badge de atraso (escondido por padrão; atualizado pelo heatmap)
    const delaySpan = document.createElement('span');
    delaySpan.id          = `delay-${i}`;
    delaySpan.className   = 'delay-badge';
    delaySpan.style.display = 'none';
    delaySpan.textContent = '0';
    delaySpan.setAttribute('aria-hidden', 'true');

    btn.appendChild(numSpan);
    btn.appendChild(delaySpan);
    btn.addEventListener('click', () => _toggle(i, btn));

    containerEl.appendChild(btn);
  }
}

/**
 * Retorna as dezenas atualmente selecionadas em ordem crescente.
 * @returns {number[]}
 */
export function getSelectedNumbers() {
  return Array.from(_selected).sort((a, b) => a - b);
}

/**
 * Define as dezenas selecionadas programaticamente (ex: ao carregar jogo salvo).
 * Atualiza classes CSS e aria-pressed em todos os botões afetados.
 *
 * @param {number[]} nums    - Array de dezenas (1–25) a selecionar
 * @param {object}   [opts]
 * @param {boolean}  [opts.silent=false] - Se true, não dispara onToggle
 */
export function setSelectedNumbers(nums, opts = {}) {
  _clearVisual();
  nums.forEach(n => {
    _selected.add(n);
    const el = document.getElementById(`num-${n}`);
    if (el) {
      el.classList.add('selected');
      el.setAttribute('aria-pressed', 'true');
    }
  });
  if (!opts.silent && _onToggle) _onToggle(getSelectedNumbers());
}

/**
 * Limpa todas as seleções (visual + estado interno).
 * Não chama onToggle — o caller é responsável por resetar métricas.
 */
export function clearBoard() {
  _selected.clear();
  _clearVisual();
}

// ─── Internos ──────────────────────────────────────────────────────────────

/**
 * Alterna a seleção de uma dezena.
 * @param {number}      num - Dezena (1–25)
 * @param {HTMLElement} el  - Botão correspondente
 */
function _toggle(num, el) {
  if (_selected.has(num)) {
    _selected.delete(num);
    el.classList.remove('selected');
    el.setAttribute('aria-pressed', 'false');
  } else if (_selected.size < _maxPick) {
    _selected.add(num);
    el.classList.add('selected');
    el.setAttribute('aria-pressed', 'true');
  }
  if (_onToggle) _onToggle(getSelectedNumbers());
}

/** Remove classe 'selected' e reseta aria-pressed de todos os botões do volante. */
function _clearVisual() {
  document.querySelectorAll('.ball').forEach(b => {
    b.classList.remove('selected');
    b.setAttribute('aria-pressed', 'false');
  });
}

