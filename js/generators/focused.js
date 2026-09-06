/**
 * js/generators/focused.js
 * Gerador de jogos com alvo de coincidência específico
 */

function bitCount(n) {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;
}

function getMaxSequence(nums) {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  let max = 1, cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) cur++;
    else { max = Math.max(max, cur); cur = 1; }
  }
  return Math.max(max, cur);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function getHeadlessFocusedGame(targetMaxCoinc, database) {
  let bestCandidate = null;
  let bestAllowedCandidate = null;
  let bestAllowedMaxMatch = -1;
  let minDiff = 999;

  for (let i = 0; i < 3000; i++) {
    const current = [];
    const pool = Array.from({ length: 25 }, (_, k) => k + 1);
    while (current.length < 15) current.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    const mask = current.reduce((m, n) => m | (1 << (n - 1)), 0);

    let maxMatch = 0;
    const limit = database.length; // usa toda a base carregada
    for (let j = 0; j < limit; j++) {
      const m = bitCount(mask & database[j].mask);
      if (m > maxMatch) maxMatch = m;
    }

    if (maxMatch <= targetMaxCoinc && maxMatch > bestAllowedMaxMatch) {
      bestAllowedMaxMatch = maxMatch;
      bestAllowedCandidate = [...current];
    }

    const diff = Math.abs(maxMatch - targetMaxCoinc);
    if (diff < minDiff) {
      minDiff = diff;
      bestCandidate = [...current];
    }
    if (bestAllowedMaxMatch === targetMaxCoinc) break;
  }

  const selected = bestAllowedCandidate || bestCandidate;
  return selected.sort((a, b) => a - b);
}

export function getHeadlessStructuredGame(database) {
  if (!database || database.length === 0) {
    return Array.from({ length: 15 }, (_, k) => k + 1);
  }

  const mode = 13;
  const limit = Math.min(database.length, 4500); // usa base carregada com teto de 4500 para performance
  let pairs = [];
  let freqPerma = new Array(26).fill(0);
  let freqEntry = new Array(26).fill(0);
  let freqExit = new Array(26).fill(0);

  for (let i = 0; i < limit; i++) {
    const c1 = database[i];
    for (let j = i + 1; j < limit; j++) {
      const c2 = database[j];
      if (bitCount(c1.mask & c2.mask) === mode) {
        pairs.push({ c1, c2 });
        for (let n = 1; n <= 25; n++) {
          if (c1.nums.includes(n) && c2.nums.includes(n)) freqPerma[n]++;
          else if (c1.nums.includes(n) || c2.nums.includes(n)) freqEntry[n]++;
          else freqExit[n]++;
        }
      }
    }
  }

  const toSortedNumbers = freq => freq.map((v, i) => ({ n: i, v })).filter(x => x.n > 0).sort((a, b) => b.v - a.v).map(x => x.n);
  const nucleusPool = toSortedNumbers(freqPerma).slice(0, 12);
  const rotationPool = toSortedNumbers(freqEntry).slice(0, 10);
  const exitPool = toSortedNumbers(freqExit).slice(0, 8);

  let bestGame = [];
  let bestScore = -1;
  const localStds = { sumLo: 170, sumHi: 220, evenLo: 6, evenHi: 9, seqCap: 5 };

  const validateGame = nums => {
    const sum = nums.reduce((a, b) => a + b, 0);
    const evens = nums.filter(n => n % 2 === 0).length;
    const maxSeq = getMaxSequence(nums);
    let score = 0;
    let valid = true;
    if (sum >= localStds.sumLo && sum <= localStds.sumHi) score += 3; else valid = false;
    if (evens >= localStds.evenLo && evens <= localStds.evenHi) score += 3; else valid = false;
    if (maxSeq <= localStds.seqCap) score += 2; else valid = false;
    return { valid, score };
  };

  for (let attempt = 0; attempt < 200; attempt++) {
    const gameResult = new Set();
    const nucCount = 6 + Math.floor(Math.random() * 3);
    const rotCount = 4 + Math.floor(Math.random() * 2);
    const transCount = 2 + Math.floor(Math.random() * 2);

    shuffle(nucleusPool).slice(0, nucCount).forEach(n => gameResult.add(n));
    shuffle(rotationPool.filter(n => !gameResult.has(n))).slice(0, rotCount).forEach(n => gameResult.add(n));
    shuffle(exitPool.filter(n => !gameResult.has(n))).slice(0, transCount).forEach(n => gameResult.add(n));

    if (gameResult.size < 15) {
      const allAvail = Array.from({ length: 25 }, (_, k) => k + 1).filter(n => !gameResult.has(n));
      const safeAvail = allAvail.filter(n => !exitPool.includes(n));
      const fillPool = safeAvail.length >= (15 - gameResult.size) ? safeAvail : allAvail;
      shuffle(fillPool).slice(0, 15 - gameResult.size).forEach(n => gameResult.add(n));
    }

    const candidate = Array.from(gameResult).slice(0, 15).sort((a, b) => a - b);
    if (candidate.length === 15) {
      const { valid, score } = validateGame(candidate);
      if (valid) { bestGame = candidate; break; }
      if (score > bestScore) { bestScore = score; bestGame = candidate; }
    }
  }

  return bestGame.length === 15 ? bestGame : Array.from({ length: 15 }, (_, k) => k + 1);
}
