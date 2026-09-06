/**
 * js/core/parser.js
 * Parsing e validação de dados históricos importados.
 * Módulo puro — sem dependências de DOM ou estado global.
 * Extraído de importHistory() em index.html (F1.2).
 */

// ---------------------------------------------------------------------------
// Utilitários internos (não exportados — usados apenas pelo parser)
// ---------------------------------------------------------------------------

/**
 * Conta bits ligados em um inteiro de 32 bits (Hamming weight / popcount).
 * @param {number} n
 * @returns {number}
 */
function bitCount(n) {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;
}

/**
 * Retorna o tamanho da maior sequência consecutiva em um array de números.
 * @param {number[]} nums - array já ordenado ou não
 * @returns {number}
 */
function getMaxSequence(nums) {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  let max = 1, current = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      current++;
    } else {
      max = Math.max(max, current);
      current = 1;
    }
  }
  return Math.max(max, current);
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Faz o parse de uma única linha no formato "ID - n1,n2,...,n15".
 * Retorna null se a linha for inválida por qualquer motivo.
 *
 * @param {string} linha
 * @returns {{ id: string, nums: number[], sum: number, mask: number, maxSeq: number } | null}
 */
export function parseLine(linha) {
  const lineStr = linha.trim();
  if (!lineStr) return null;

  const separatorIndex = lineStr.indexOf('-');
  if (separatorIndex === -1) return null;

  const idPart   = lineStr.substring(0, separatorIndex).trim();
  const numsPart = lineStr.substring(separatorIndex + 1).trim();

  if (!idPart || !numsPart || !/\d/.test(idPart)) return null;

  const rawTokens = numsPart.split(/[,;\s]+/).filter(s => s.trim() !== '');
  if (rawTokens.length !== 15) return null;

  const parsedNums = rawTokens.map(Number);
  if (parsedNums.some(n => isNaN(n) || !Number.isInteger(n) || n < 1 || n > 25)) return null;

  const uniqueNums = new Set(parsedNums);
  if (uniqueNums.size !== 15) return null;

  const nums = Array.from(uniqueNums).sort((a, b) => a - b);
  const mask = nums.reduce((m, n) => m | (1 << (n - 1)), 0);

  return {
    id:     idPart,
    nums,
    sum:    nums.reduce((a, b) => a + b, 0),
    mask,
    maxSeq: getMaxSequence(nums),
  };
}

/**
 * Processa um array de linhas brutas e retorna a base de dados validada
 * junto com as contagens de linhas válidas e inválidas.
 * Duplicatas de ID dentro do mesmo lote são descartadas (contam como inválidas).
 *
 * @param {string[]} linhas
 * @returns {{ db: object[], valid: number, invalid: number }}
 */
export function parseLines(linhas) {
  const db = [];
  let valid = 0;
  let invalid = 0;
  const seenIds = new Set();

  for (const linha of linhas) {
    if (!linha.trim()) continue; // linhas vazias não contam como erro

    const contest = parseLine(linha);
    if (!contest) { invalid++; continue; }
    if (seenIds.has(contest.id)) { invalid++; continue; }

    seenIds.add(contest.id);
    db.push(contest);
    valid++;
  }

  return { db, valid, invalid };
}

/**
 * Importa texto bruto completo (multi-linha) e retorna o resultado do parse.
 * Se nenhuma linha válida for encontrada, preserva a base anterior intacta.
 *
 * @param {object[]} baseAnterior - base de dados atual (array de contests)
 * @param {string}   texto        - conteúdo bruto colado pelo usuário
 * @returns {{ db: object[], valid: number, invalid: number, preserved: boolean }}
 */
export function importarComBase(baseAnterior, texto) {
  const linhas = texto.split('\n');
  const { db, valid, invalid } = parseLines(linhas);

  if (valid === 0) {
    return { db: baseAnterior, valid: 0, invalid, preserved: true };
  }

  return { db, valid, invalid, preserved: false };
}

// ---------------------------------------------------------------------------
// Adaptador mínimo de UI usado pelos testes e por integrações futuras.
// Mantém estado próprio sem interferir no main.js atual.
// ---------------------------------------------------------------------------
let uiDatabase = [];

export async function importHistory() {
  if (typeof document === 'undefined') return { db: uiDatabase, valid: 0, invalid: 0, preserved: true };
  const rawEl = document.getElementById('raw-data');
  const text = rawEl ? rawEl.value : '';
  const result = importarComBase(uiDatabase, text);
  uiDatabase = result.db;
  const totalEl = document.getElementById('total-contests');
  const validEl = document.getElementById('valid-count');
  const invalidEl = document.getElementById('invalid-count');
  if (totalEl) totalEl.textContent = String(uiDatabase.length);
  if (validEl) validEl.textContent = String(result.valid);
  if (invalidEl) invalidEl.textContent = String(result.invalid);
  return result;
}

export function getImportedDatabase() {
  return [...uiDatabase];
}
