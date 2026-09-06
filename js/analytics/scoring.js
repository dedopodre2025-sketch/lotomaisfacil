/**
 * Motor de scoring puro e testável.
 * Os scores abaixo medem aderência estrutural, diversidade e risco de padrão humano.
 * Eles NÃO representam probabilidade de prêmio e devem ser validados contra um controle aleatório.
 */
import { bitCount, getMaxSequence } from '../core/utils.js';

export const WEIGHTS = Object.freeze({
  sum: 15, repeat: 20, parity: 10, highlow: 10,
  primes: 10, sequence: 10, spatial: 15, frame: 10,
});

export let DYNAMIC_WEIGHTS = { ...WEIGHTS };

const PRIMES = new Set([2, 3, 5, 7, 11, 13, 17, 19, 23]);
const FRAME = new Set([1,2,3,4,5,6,10,11,15,16,20,21,22,23,24,25]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toMask(nums) {
  return nums.reduce((m, n) => m | (1 << (n - 1)), 0);
}

/**
 * Índice anti-crowd: estima apenas o quanto uma combinação contém padrões
 * visualmente óbvios que apostadores humanos tendem a escolher.
 * Não altera a probabilidade matemática do sorteio.
 */
export function calculateHumanPopularity(nums) {
  if (!Array.isArray(nums)) return 0;
  let score = 0;
  const maxSeq = getMaxSequence(nums);
  const lows = nums.filter(n => n <= 15).length;

  if (maxSeq >= 5) score += 30;
  else if (maxSeq >= 4) score += 15;

  if (lows >= 11) score += 25;

  const corners = [1, 5, 21, 25];
  if (corners.every(n => nums.includes(n))) score += 10;

  if (nums.filter(n => n % 5 === 0).length === 5) score += 15;

  const rowCounts = [0, 0, 0, 0, 0];
  nums.forEach(n => {
    if (Number.isInteger(n) && n >= 1 && n <= 25) rowCounts[Math.floor((n - 1) / 5)]++;
  });
  if (rowCounts.some(r => r === 5)) score += 20;

  return clamp(score, 0, 100);
}

export function calculateAdherenceScore(metrics, weights = DYNAMIC_WEIGHTS) {
  const safeMetrics = metrics || {};
  const safeWeights = weights || DYNAMIC_WEIGHTS;
  const points = (status, weight) => {
    if (status === 'IDEAL') return weight;
    if (status === 'ACEITÁVEL' || status === 'ACEITAVEL') return weight * 0.7;
    return weight * 0.3;
  };

  let total = 0;
  for (const key of Object.keys(WEIGHTS)) {
    total += points(safeMetrics[key], Number(safeWeights[key]) || 0);
  }
  return Math.round(clamp(total, 0, 100));
}

export function calculateCoverageQuality(currentNums, savedGames = []) {
  if (!Array.isArray(currentNums) || savedGames.length === 0) {
    return { score: 0, coveragePerc: 0, maxOverlap: 0 };
  }

  const frequencies = new Array(26).fill(0);
  const currentMask = toMask(currentNums);
  let maxOverlap = 0;

  for (const game of savedGames) {
    if (!game || !Array.isArray(game.nums)) continue;
    for (const n of game.nums) if (n >= 1 && n <= 25) frequencies[n]++;
    const savedMask = Number.isInteger(game.mask) ? game.mask : toMask(game.nums);
    maxOverlap = Math.max(maxOverlap, bitCount(currentMask & savedMask));
  }
  for (const n of currentNums) if (n >= 1 && n <= 25) frequencies[n]++;

  const covered = frequencies.slice(1).filter(v => v > 0).length;
  const coveragePerc = Math.round((covered / 25) * 100);

  let repetitionScore = 100;
  if (maxOverlap > 10) repetitionScore = Math.max(0, 100 - ((maxOverlap - 10) * 20));

  const score = Math.round((coveragePerc * 0.6) + (repetitionScore * 0.4));
  return { score, coveragePerc, maxOverlap };
}

/**
 * Ajuste moderado dos pesos conforme concentração histórica.
 * O retorno sempre soma ~100 e é apenas heurístico; não é confiança estatística.
 */
export function updateDynamicWeights(stats = {}, baseCount = 0) {
  if (baseCount < 50) {
    DYNAMIC_WEIGHTS = { ...WEIGHTS };
    return { ...DYNAMIC_WEIGHTS };
  }

  const getTopPerc = (distribution = {}) => {
    const values = Object.values(distribution).map(Number).filter(Number.isFinite);
    if (!values.length) return 25;
    return (Math.max(...values) / baseCount) * 100;
  };

  const topPercs = {
    sum: getTopPerc(stats.sums),
    repeat: getTopPerc(stats.repeats),
    parity: getTopPerc(stats.parity),
    highlow: getTopPerc(stats.highlow),
    primes: getTopPerc(stats.primes),
    sequence: getTopPerc(stats.sequences),
    frame: getTopPerc(stats.moldura),
    spatial: 25,
  };

  const raw = {};
  let total = 0;
  for (const key of Object.keys(WEIGHTS)) {
    const factor = clamp(1 + ((topPercs[key] - 25) / 100), 0.7, 1.3);
    raw[key] = WEIGHTS[key] * factor;
    total += raw[key];
  }

  DYNAMIC_WEIGHTS = {};
  for (const key of Object.keys(WEIGHTS)) DYNAMIC_WEIGHTS[key] = (raw[key] / total) * 100;
  return { ...DYNAMIC_WEIGHTS };
}

export function calcularStrategicScore(historicalScore, humanPopularity, coverageScore) {
  const hist = clamp(Number(historicalScore) || 0, 0, 100);
  const pop = clamp(Number(humanPopularity) || 0, 0, 100);
  const cov = clamp(Number(coverageScore) || 0, 0, 100);
  return Math.round(clamp(
    (hist * 0.45) + ((100 - pop) * 0.35) + (Math.min(100, cov * 2.5) * 0.20),
    0,
    100,
  ));
}

/**
 * Avaliação headless simples para módulos/ testes. A UI principal usa padrões
 * históricos mais detalhados; aqui mantemos uma versão desacoplada do DOM.
 */
export function evaluateCandidate(nums, database = [], savedGames = []) {
  if (!Array.isArray(nums) || nums.length === 0) {
    return { strategicScore: 0, historicalScore: 0, humanPopularity: 0, coverageScore: 0 };
  }

  const count = nums.length;
  const sum = nums.reduce((a, b) => a + b, 0);
  const evens = nums.filter(n => n % 2 === 0).length;
  const lows = nums.filter(n => n <= 13).length;
  const primes = nums.filter(n => PRIMES.has(n)).length;
  const frame = nums.filter(n => FRAME.has(n)).length;
  const seq = getMaxSequence(nums);
  const currentMask = toMask(nums);
  const repeat = database.length ? bitCount(currentMask & (database[0].mask ?? toMask(database[0].nums || []))) : 9;

  const statusRange = (v, lo, hi, margin = 1) => v >= lo && v <= hi ? 'IDEAL' : (v >= lo - margin && v <= hi + margin ? 'ACEITÁVEL' : 'FORA');
  const metrics = {
    sum: statusRange(sum, count === 15 ? 175 : 185, count === 15 ? 215 : 235, 10),
    repeat: statusRange(repeat, 8, 10, 1),
    parity: statusRange(evens, 6, 9, 1),
    highlow: statusRange(lows, 7, 9, 1),
    primes: statusRange(primes, 4, 7, 1),
    sequence: seq <= 4 ? 'IDEAL' : (seq === 5 ? 'ACEITÁVEL' : 'FORA'),
    frame: statusRange(frame, 8, 11, 1),
    spatial: 'IDEAL',
  };

  const historicalScore = calculateAdherenceScore(metrics);
  const humanPopularity = calculateHumanPopularity(nums);
  const coverageScore = calculateCoverageQuality(nums, savedGames).score;
  return {
    strategicScore: calcularStrategicScore(historicalScore, humanPopularity, coverageScore),
    historicalScore,
    humanPopularity,
    coverageScore,
  };
}
