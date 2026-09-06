// Coincidências históricas exatas dos jogos internos. Não é modelo preditivo.
export const TOTAL_RESULTS = 3268760;
export function mask15(nums) {
    if (!Array.isArray(nums) || nums.length !== 15 || new Set(nums).size !== 15 ||
        nums.some(n => !Number.isInteger(n) || n < 1 || n > 25)) {
        throw new Error('Cada concurso precisa ter 15 dezenas distintas de 1 a 25.');
    }
    return nums.reduce((mask, n) => mask | (1 << (n - 1)), 0);
}
function bitCount(n) {
    n -= (n >>> 1) & 0x55555555;
    n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
    return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
export function combinations15(selection) {
    if (!Array.isArray(selection) || selection.length < 15 || selection.length > 18 ||
        new Set(selection).size !== selection.length ||
        selection.some(n => !Number.isInteger(n) || n < 1 || n > 25)) {
        throw new Error('Selecione de 15 a 18 dezenas distintas de 1 a 25.');
    }
    const nums = [...selection].sort((a,b) => a-b), out = [];
    function visit(start, picked) {
        if (picked.length === 15) { out.push([...picked]); return; }
        for (let i = start; i <= nums.length - (15 - picked.length); i++) {
            picked.push(nums[i]); visit(i+1, picked); picked.pop();
        }
    }
    visit(0, []);
    return out;
}
export function analyzeInternalGames(selection, database, onProgress = () => {}) {
    const combinations = combinations15(selection);
    if (!Array.isArray(database) || !database.length) throw new Error('Importe uma base histórica antes de analisar.');
    const seen = new Set();
    const history = database.map(c => {
        const id = String(c.id);
        if (!/^\d+$/.test(id) || Number(id) < 1 || !Number.isSafeInteger(Number(id))) throw new Error('ID de concurso inválido.');
        if (seen.has(Number(id))) throw new Error('A base possui IDs de concurso repetidos.');
        seen.add(Number(id));
        return {id, mask: mask15(c.nums)};
    });
    const counts = {upTo12:0, max13:0, max14:0, max15:0};
    const games = combinations.map((nums, i) => {
        const mask = mask15(nums);
        let max = -1, maxCount = 0, exampleContest = '';
        for (const contest of history) {
            const hit = bitCount(mask & contest.mask);
            if (hit > max) { max = hit; maxCount = 1; exampleContest = contest.id; }
            else if (hit === max) maxCount++;
        }
        counts[max <= 12 ? 'upTo12' : 'max'+max]++;
        if ((i+1)%50 === 0 || i+1 === combinations.length) onProgress(i+1, combinations.length);
        return {nums, max, maxCount, exampleContest};
    });
    return {selection:[...selection].sort((a,b)=>a-b), total:games.length, counts, games,
        historyCount:history.length, oldest:Math.min(...seen), newest:Math.max(...seen),
        fullProbability15:games.length/TOTAL_RESULTS};
}
export function filterInternalGames(result, filter = 'upTo13') {
    if (!['all','upTo12','upTo13','max13','max14','max15'].includes(filter)) throw new Error('Filtro inválido.');
    return result.games.filter(game => filter === 'all' ||
        (filter === 'upTo12' && game.max <= 12) || (filter === 'upTo13' && game.max <= 13) ||
        (filter.startsWith('max') && game.max === Number(filter.slice(3))));
}
export function exportInternalGames(games) {
    return games.map(game => game.nums.map(n=>String(n).padStart(2,'0')).join(',')).join('\n') + (games.length ? '\n' : '');
}
