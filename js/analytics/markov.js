// js/analytics/markov.js
// F3.8 — Matrizes de Markov para paridade, soma e primos
// Modela P(estado_t+1 | estado_t) a partir do historico de sorteios.

const PRIMES_MARKOV = new Set([2, 3, 5, 7, 11, 13, 17, 19, 23]);

// ── Extratores de estado ─────────────────────────────────────────────────────
const parityOf = nums => nums.filter(n => n % 2 === 0).length;
const sumOf    = nums => Math.floor(nums.reduce((a, b) => a + b, 0) / 10); // bucket de 10 (ex: 17 = 170-179)
const primesOf = nums => nums.filter(n => PRIMES_MARKOV.has(n)).length;

// ── Construtor de matriz para uma dimensao ───────────────────────────────────
function buildOneDim(db, stateOf) {
    // db[0] = mais recente; transicao: db[i+1] (t) -> db[i] (t+1)
    const counts = new Map();

    for (let i = db.length - 1; i > 0; i--) {
        const from = stateOf(db[i].nums);     // estado em t
        const to   = stateOf(db[i - 1].nums); // estado em t+1
        if (!counts.has(from)) counts.set(from, new Map());
        const row = counts.get(from);
        row.set(to, (row.get(to) || 0) + 1);
    }

    // Normaliza para probabilidades
    const matrix = new Map();
    for (const [from, row] of counts) {
        const total = [...row.values()].reduce((a, b) => a + b, 0);
        const probs = new Map();
        for (const [to, cnt] of row) probs.set(to, cnt / total);
        matrix.set(from, probs);
    }

    // Pre-computa estado mais provavel para cada estado de origem
    const probNext = new Map();
    for (const [from, probs] of matrix) {
        let bestState = null;
        let bestProb  = -1;
        for (const [to, p] of probs) {
            if (p > bestProb) { bestProb = p; bestState = to; }
        }
        probNext.set(from, { state: bestState, prob: bestProb });
    }

    const currentState = db.length > 0 ? stateOf(db[0].nums) : null;

    return { matrix, probNext, currentState, stateOf };
}

// ── API publica ──────────────────────────────────────────────────────────────

/**
 * Constroi 3 matrizes de Markov (paridade, soma, primos) a partir do historico.
 * @param {Array} db - Concursos do mais recente (db[0]) ao mais antigo.
 * @returns {{ parity, sum, primes } | null}
 */
export function construirMatrizTransicao(db) {
    if (!db || db.length < 2) return null;
    return {
        parity: buildOneDim(db, parityOf),
        sum:    buildOneDim(db, sumOf),
        primes: buildOneDim(db, primesOf),
    };
}

/**
 * Retorna o proximo estado mais provavel dado estado atual em uma dimensao.
 * @param {{ probNext, currentState }} markovDim
 * @param {number|null} currentState - se omitido usa markovDim.currentState
 * @returns {{ state: number, prob: number } | null}
 */
export function getProximoEstadoProvavel(markovDim, currentState) {
    if (!markovDim) return null;
    const cs = currentState !== undefined ? currentState : markovDim.currentState;
    if (cs === null) return null;
    return markovDim.probNext.get(cs) ?? null;
}

/**
 * Verifica se um jogo (15 numeros) e compativel com as previsoes Markov.
 * @param {number[]} nums
 * @param {{ parity, sum, primes }} markovData - resultado de construirMatrizTransicao()
 * @returns {{
 *   parityOk: boolean|null,
 *   sumOk:    boolean|null,
 *   primesOk: boolean|null,
 *   score: number (0-3),
 *   nextParity: number|null,
 *   nextSum:    number|null,
 *   nextPrimes: number|null,
 *   actualParity: number,
 *   actualSum:    number,
 *   actualPrimes: number,
 * }}
 */
export function checkMarkovCompatibility(nums, markovData) {
    if (!markovData) {
        return { parityOk: null, sumOk: null, primesOk: null, score: 0,
                 nextParity: null, nextSum: null, nextPrimes: null,
                 actualParity: 0, actualSum: 0, actualPrimes: 0 };
    }

    const { parity, sum, primes } = markovData;

    const npRaw = getProximoEstadoProvavel(parity);
    const nsRaw = getProximoEstadoProvavel(sum);
    const nprimRaw = getProximoEstadoProvavel(primes);

    const nextParity = npRaw   ? npRaw.state   : null;
    const nextSum    = nsRaw   ? nsRaw.state    : null;
    const nextPrimes = nprimRaw ? nprimRaw.state : null;

    const actualParity = parityOf(nums);
    const actualSum    = sumOf(nums);
    const actualPrimes = primesOf(nums);

    const parityOk = nextParity !== null && actualParity === nextParity;
    const sumOk    = nextSum    !== null && actualSum    === nextSum;
    const primesOk = nextPrimes !== null && actualPrimes === nextPrimes;

    return {
        parityOk, sumOk, primesOk,
        score: (parityOk ? 1 : 0) + (sumOk ? 1 : 0) + (primesOk ? 1 : 0),
        nextParity, nextSum, nextPrimes,
        actualParity, actualSum, actualPrimes,
    };
}