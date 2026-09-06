/**
 * js/core/utils.js
 * Funções utilitárias puras e reutilizáveis.
 */

/**
 * Conta o número de bits 1 em um inteiro de 32 bits (Hamming weight).
 * Usado para calcular coincidências entre máscaras bitmask de jogos.
 * @param {number} n
 * @returns {number}
 */
export function bitCount(n) {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;
}

/**
 * Retorna o comprimento da maior sequência consecutiva no array de números.
 * @param {number[]} nums - Array de números (não precisa estar ordenado)
 * @returns {number}
 */
export function getMaxSequence(nums) {
  if (!Array.isArray(nums) || nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  let max = 1;
  let current = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      current += 1;
    } else {
      max = Math.max(max, current);
      current = 1;
    }
  }
  return Math.max(max, current);
}

/**
 * Escapa caracteres HTML para prevenção de XSS.
 * @param {string} str
 * @returns {string}
 */
export function sanitizeHTML(str) {
  return String(str).replace(/[&<>'"]/g, chr => {
    switch (chr) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return chr;
    }
  });
}
