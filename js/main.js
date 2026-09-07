import { summarizeTransitions } from './analytics/transitions.js?v=5.5.0';
import { createPortfolioPanel } from './ui/portfolio.js?v=5.5.0';
/**
 * js/main.js
 * Bootstrap da aplicação LotoMaisFácil.
 * Migrado de index.html (F1.8) — contém toda a lógica da aplicação.
 *
 * Módulos já extraídos (F1.2–F1.7):
 *   js/core/parser.js      — parseLine, parseLines, importarComBase
 *   js/core/utils.js       — sanitizeHTML, bitCount, buildMask, ...
 *   js/ui/toast.js         — showToast
 *   js/ui/modal.js         — showConfirmModal
 *   js/ui/board.js         — initBoard, getSelectedNumbers, setSelectedNumbers, clearBoard
 *   js/ui/tabs.js          — initTabs, switchTab
 *   js/data/defaultData.js — DEFAULT_HISTORY
 *
 * Os módulos UI estão prontos mas as funções inline equivalentes permanecem
 * aqui por compatibilidade. A integração completa acontece em fases futuras.
 */

import { DEFAULT_HISTORY } from './data/defaultData.js?v=5.5.0';
import { createInternalGamesPanel } from './ui/internalGames.js?v=5.5.0';
import { sanitizeHTML } from './core/utils.js';
import {
    calculateHumanPopularity as calculateHumanPopularityCore,
    calculateAdherenceScore as calculateAdherenceScoreCore,
    updateDynamicWeights as updateDynamicWeightsCore
} from './analytics/scoring.js';
import {
    getHeadlessSmartGame as getHeadlessSmartGameCore,
    calibrateSmartWeights as calibrateSmartWeightsCore,
    SMART_COMPONENTS as SMART_COMPONENTS_CORE,
    SMART_WEIGHTS as SMART_WEIGHTS_CORE
} from './generators/smart.js';
import { getHeadlessFocusedGame as getHeadlessFocusedGameCore } from './generators/focused.js';
import { calcularMatrizCoOcorrencia, calcularCoesaoPares, clusterizarJaccard, calcularDiversidadeCluster } from './analytics/cooccurrence.js';
import { construirMatrizTransicao, checkMarkovCompatibility } from './analytics/markov.js';
import { salvar, buscarTodos, buscarUm, buscarPaginado, salvarLote, deletar, migrarLocalStorageParaIDB } from './core/db.js'; // F4.2–F4.10
const SNIPER_WORKER_BUILD = 'v5.1-focus-blocks-20260816';
const AFFINITY13_WORKER_BUILD = 'v5.2-affinity13-lab-20260816';
let activeAffinity13Worker = null;
let database = []; 
let selectedNumbers = new Set();
const internalGamesPanel = createInternalGamesPanel(() => ({selection: [...selectedNumbers], database}));
let coOcorrenciaData = null; // Matriz de co-ocorrência + chi-quadrado (computada sob demanda)
let clusterData     = null; // F3.11 — Clusters Jaccard (5 grupos de dezenas)
let markovData      = null; // F3.8 — Matrizes de Markov (paridade, soma, primos)
// F3.7 — Pesos do Score Estratégico (calibráveis via grid search)
let scoreWeights = { h: 0.45, p: 0.35, c: 0.20 };

// NOVO: Cache de otimização global para evitar recálculos pesados
let systemCache = {
    tableHtml: null,
    heatmap: { counts: null, delays: null, dbLength: 0 },
    dist: { stats: null, sumsMap: null, dbLength: 0 },
    savedGamesHash: '',
    baseFrequencies: new Array(26).fill(0),
    savedMasks: [],
    smartAuto: { dbKey: '', calibration: null }
};

let mySavedGames = [];
try {
    const lsGames = localStorage.getItem('lotoSavedGames');
    if (lsGames) {
        mySavedGames = JSON.parse(lsGames);
        console.log(`✅ [Sistema] ${mySavedGames.length} jogos salvos restaurados com sucesso.`);
    }
} catch(e) {
    console.warn(`⚠️ [Aviso] Jogos salvos corrompidos no armazenamento. Iniciando lista limpa.`);
    localStorage.removeItem('lotoSavedGames');
}

let historicalStandards = {
    sums: { ideal: null, acceptable: [] },
    repeats: { ideal: null, acceptable: [] },
    parity: { ideal: null, acceptable: [] },
    highlow: { ideal: null, acceptable: [] },
    primes: { ideal: null, acceptable: [] },
    sequence: { ideal: null, acceptable: [] },
    moldura: { ideal: null, acceptable: [] },
    spatial: true
};

const WEIGHTS = { sum: 15, repeat: 20, parity: 10, highlow: 10, primes: 10, sequence: 10, spatial: 15, frame: 10 };
let DYNAMIC_WEIGHTS = { ...WEIGHTS }; // NOVO: Pesos modulados inteligentemente pela base

const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23];
const FRAME = [1,2,3,4,5,6,10,11,15,16,20,21,22,23,24,25];
const QUADRANTS = { Q1: [1, 2, 3, 6, 7, 8, 11, 12, 13], Q2: [4, 5, 9, 10, 14, 15], Q3: [16, 17, 18, 21, 22, 23], Q4: [19, 20, 24, 25] };
const RULES = { max_coinc: 12, quad_warn: 7, seq_alert: 5, max_pick: 18, parity: [6,9], sum: [170,220] };

// Toast inline — versão definitiva em js/ui/toast.js (migrar em F1.8)
function showToast(msg, type = 'info') {
    const colors = { info: '#3b82f6', success: '#22c55e', error: '#ef4444', warning: '#f59e0b' };
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 18px;border-radius:8px;color:#fff;font-size:14px;font-weight:600;background:${colors[type]||colors.info};box-shadow:0 4px 12px rgba(0,0,0,.2);transition:opacity .4s`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3500);
}

// Modal de confirmação inline — versão definitiva em js/ui/modal.js (migrar em F1.8)
function showConfirmModal(message, onConfirm) {
    const overlay = document.getElementById('confirm-modal');
    document.getElementById('confirm-modal-msg').textContent = message;
    overlay.style.display = 'flex';
    const btnOk     = document.getElementById('confirm-modal-ok');
    const btnCancel = document.getElementById('confirm-modal-cancel');
    const close = () => { overlay.style.display = 'none'; btnOk.onclick = null; btnCancel.onclick = null; };
    btnOk.onclick     = () => { close(); onConfirm(); };
    btnCancel.onclick = () => close();
}

// Cache para o motor de conexões
let lastConexaoAnalysis = { perma: [], entry: [], exit: [] };
let conexaoMode = 13; // 12 ou 13

// Nova função auxiliar: Ajusta pesos baseados na dominância estatística real
function updateDynamicWeights(stats, baseCount) {
    const updated = updateDynamicWeightsCore(stats, baseCount);
    DYNAMIC_WEIGHTS = { ...updated };
    return DYNAMIC_WEIGHTS;
}

function bitCount(n) { n = n - ((n >> 1) & 0x55555555); n = (n & 0x33333333) + ((n >> 2) & 0x33333333); return (((n + (n >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24; }

function getMaxSequence(nums) {
    if (nums.length === 0) return 0;
    let sorted = [...nums].sort((a,b) => a - b);
    let max = 1, current = 1;
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === sorted[i-1] + 1) current++; else { max = Math.max(max, current); current = 1; }
    }
    return Math.max(max, current);
}

function calculateHumanPopularity(nums) {
    return calculateHumanPopularityCore(nums);
}

function updateSavedGamesCache() {
    // Cria um hash baseado na quantidade de jogos e ID do mais recente para invalidar o cache
    const currentHash = mySavedGames.length + '-' + (mySavedGames[0] ? mySavedGames[0].id : '');
    if (systemCache.savedGamesHash !== currentHash) {
        systemCache.baseFrequencies.fill(0);
        systemCache.savedMasks = [];
        mySavedGames.forEach(g => {
            let mask = 0;
            g.nums.forEach(n => {
                systemCache.baseFrequencies[n]++;
                mask |= (1 << (n - 1));
            });
            systemCache.savedMasks.push(mask);
        });
        systemCache.savedGamesHash = currentHash;
    }
}

function calculateCoverageQuality(currentNums) {
    if (mySavedGames.length === 0) return { score: 0, coveragePerc: 0, maxOverlap: 0 };
    
    updateSavedGamesCache();
    
    // Trabalha apenas com os caches prontos em vez de loops pesados sobre todo o histórico salvo
    const frequencies = [...systemCache.baseFrequencies];
    let currentMask = 0;
    currentNums.forEach(n => {
        frequencies[n]++;
        currentMask |= (1 << (n - 1));
    });
    
    let maxOverlap = 0;
    const masksLen = systemCache.savedMasks.length;
    for (let i = 0; i < masksLen; i++) {
        const overlap = bitCount(currentMask & systemCache.savedMasks[i]);
        if (overlap > maxOverlap) maxOverlap = overlap;
    }

    // 1. Cobertura Real (1 a 25)
    let covered = 0;
    for(let i=1; i<=25; i++) {
        if (frequencies[i] > 0) covered++;
    }
    const coveragePerc = Math.round((covered / 25) * 100);

    // 2. Repetição (Penaliza se o jogo atual for muito parecido com algum salvo)
    let repScore = 100;
    if (maxOverlap > 10) {
        repScore = Math.max(0, 100 - ((maxOverlap - 10) * 20)); // Cai 20 pontos por cada dezena repetida acima de 10
    }

    // Média ponderada: 60% peso na cobertura das 25 dezenas, 40% peso na exclusividade/baixa repetição
    const score = Math.round((coveragePerc * 0.6) + (repScore * 0.4));
    
    return { score, coveragePerc, maxOverlap };
}

// F2.5 — Significância qui-quadrado por dimensão.
// Para cada dimensão, p-value empírico = soma das P(categorias tão raras ou mais raras).
//   p < 0.05 → estatisticamente raro (sign. 95%)   p < 0.01 → muito raro (sign. 99%)
function getSignificanciaQui2(nums) {
    if (!nums || nums.length === 0 || database.length < 50 ||
        !systemCache.dist || !systemCache.dist.stats || !systemCache.dist.dbLength) {
        return { dims: {}, overall: { label: 'Padrão Comum', class: 'rarity-low', level: 1 } };
    }
    const stats  = systemCache.dist.stats;
    const count  = nums.length;
    const mask   = nums.reduce((m, n) => m | (1 << (n - 1)), 0);
    const evens  = nums.filter(n => n % 2 === 0).length;
    const lows   = nums.filter(n => n <= 13).length;
    const sum    = nums.reduce((a, b) => a + b, 0);
    const primes = nums.filter(n => PRIMES.includes(n)).length;
    const frame  = nums.filter(n => FRAME.includes(n)).length;
    const maxSeq = getMaxSequence(nums);
    const reps   = database.length > 0 ? bitCount(mask & database[0].mask) : 0;
    const currentKeys = {
        parity:    evens + 'P / ' + (count - evens) + 'Ã',
        highlow:   lows  + 'B / ' + (count - lows)  + 'A',
        sums:      (Math.floor(sum / 10) * 10) + '-' + (Math.floor(sum / 10) * 10 + 9),
        primes:    primes   + ' Primos',
        sequences: 'Seq. de ' + maxSeq,
        moldura:   frame    + ' Moldura',
        repeats:   reps     + ' Repetidas'
    };
    const dims = {};
    let countSignif = 0, minP = 1;
    for (const dim in currentKeys) {
        if (!stats[dim]) continue;
        const dist  = stats[dim];
        const total = Object.values(dist).reduce((s, v) => s + v, 0);
        if (total === 0) continue;
        const key      = currentKeys[dim];
        const obsCount = dist[key] || 0;
        const obsProb  = obsCount / total;
        const pValue   = Object.values(dist)
            .filter(c => (c / total) <= obsProb + 1e-9)
            .reduce((s, c) => s + c / total, 0);
        dims[dim] = { p: +pValue.toFixed(4), freq: +(obsProb * 100).toFixed(1), key };
        if (pValue < 0.05) countSignif++;
        if (pValue < minP)  minP = pValue;
    }
    let label, cls, level;
    if      (minP < 0.01 || countSignif >= 4) { label = 'Anômalo';      cls = 'rarity-high'; level = 4; }
    else if (minP < 0.03 || countSignif >= 3) { label = 'Muito Raro';   cls = 'rarity-high'; level = 3; }
    else if (minP < 0.10 || countSignif >= 1) { label = 'Raro';         cls = 'rarity-med';  level = 2; }
    else                                      { label = 'Padrão Comum'; cls = 'rarity-low';  level = 1; }
    return { dims, overall: { label, class: cls, level } };
}
function updateAnalysis() {
    internalGamesPanel.invalidate();
    const nums = Array.from(selectedNumbers).sort((a,b) => a - b);
    
    // NOVO: Persiste no localStorage as dezenas atualmente selecionadas
    try {
        localStorage.setItem('lotoCurrentBoard', JSON.stringify(nums));
    } catch(e) {
        if (e.name === 'QuotaExceededError') showToast('Armazenamento local cheio. Selecção não persistida.', 'warning');
    }

    const count = nums.length;
    const counterEl = document.getElementById('counter');
    if (counterEl) counterEl.textContent = `${count} / ${RULES.max_pick}`;
    
    if (count === 0) { resetMetrics(); return; }
    const currentMask = nums.reduce((m, n) => m | (1 << (n - 1)), 0);
    
    const evens = nums.filter(n => n % 2 === 0).length;
    const lows = nums.filter(n => n <= 13).length;
    const sum = nums.reduce((a,b) => a + b, 0);
    const primes = nums.filter(n => PRIMES.includes(n)).length;
    const frame = nums.filter(n => FRAME.includes(n)).length;
    const maxSeq = getMaxSequence(nums);

    let maxMatch = 0;
    let count13Matches = 0;
    database.forEach(c => {
        const m = bitCount(currentMask & c.mask);
        if (m > maxMatch) maxMatch = m;
        if (m === 13) count13Matches += 1;
    });

    const valSoma = `${Math.floor(sum / 10) * 10}-${Math.floor(sum / 10) * 10 + 9}`;
    const valRepeatNum = database.length > 0 ? bitCount(currentMask & database[0].mask) : 0;
    const valRepeat = `${valRepeatNum} Repetidas`;
    const valParity = `${evens}P / ${count-evens}Í`;
    const valHL = `${lows}B / ${count-lows}A`;
    const valPrimes = `${primes} Primos`;
    const valSeq = `Seq. de ${maxSeq}`;
    const valFrame = `${frame} Moldura`;

    const spatialOk = updateSpatialDistribution(nums);

    const getStatus = (std, currentVal) => {
        if(std.ideal === currentVal) return "IDEAL";
        if(std.acceptable.includes(currentVal)) return "ACEITÁVEL";
        return "FORA";
    };

    const metrics = {
        sum: getStatus(historicalStandards.sums, valSoma),
        repeat: getStatus(historicalStandards.repeats, valRepeat),
        parity: getStatus(historicalStandards.parity, valParity),
        highlow: getStatus(historicalStandards.highlow, valHL),
        primes: getStatus(historicalStandards.primes, valPrimes),
        sequence: getStatus(historicalStandards.sequence, valSeq),
        frame: getStatus(historicalStandards.moldura, valFrame),
        spatial: spatialOk ? "IDEAL" : "FORA"
    };

    updateMetricRow('sum', sum, metrics.sum);
    updateMetricRow('repeat', valRepeatNum, metrics.repeat);
    updateMetricRow('parity', valParity, metrics.parity);
    updateMetricRow('highlow', valHL, metrics.highlow);
    updateMetricRow('primes', primes, metrics.primes);
    updateMetricRow('frame', frame, metrics.frame);
    updateMetricRow('max-sequence', maxSeq, metrics.sequence);

    let maxCoincStatus = 'IDEAL';
    if (maxMatch <= 12) {
        maxCoincStatus = 'IDEAL';
    } else if (maxMatch === 13) {
        if (count13Matches === 1) maxCoincStatus = 'IDEAL';
        else if (count13Matches === 2) maxCoincStatus = 'ACEITÁVEL';
        else maxCoincStatus = 'FORA';
    } else {
        maxCoincStatus = 'FORA';
    }
    updateMetricRow('max-coinc', `${maxMatch} acertos`, maxCoincStatus);

    checkHistoricalHitsFast(currentMask);
    
    const historicalScore = calculateAdherenceScore(metrics);
    const humanPopularity = calculateHumanPopularity(nums);
    const coverageData = calculateCoverageQuality(nums);
    const coverageScore = coverageData.score !== undefined ? coverageData.score : coverageData;
    const strategicScore = Math.round((historicalScore * scoreWeights.h) + ((100 - humanPopularity) * scoreWeights.p) + (Math.min(100, coverageScore * 2.5) * scoreWeights.c));

    renderIntelligence(historicalScore, strategicScore, humanPopularity, coverageData, metrics);
    
    const btnOpt = document.getElementById('btn-optimize');
    if(btnOpt) btnOpt.classList.toggle('hidden', count < 15);
}

function calculateAdherenceScore(metrics) {
    return calculateAdherenceScoreCore(metrics, DYNAMIC_WEIGHTS);
}

function renderIntelligence(hist, strat, pop, cov, metrics) {
    const nums    = Array.from(selectedNumbers).sort((a, b) => a - b);
    const sigQui2 = getSignificanciaQui2(nums);
    const rarity  = sigQui2.overall;
    const riskLabel = pop > 50 ? "PADRÃO HUMANO ALTO" : (pop > 25 ? "PADRÃO HUMANO MÉDIO" : "PADRÃO HUMANO BAIXO");
    const riskClass = pop > 50 ? "risk-high" : "risk-low";

    const setTxt = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };
    const setWidth = (id, w) => { const el = document.getElementById(id); if(el) el.style.width = w; };

    setTxt('score-history', hist);
    setTxt('score-strategy', strat);
    setWidth('fill-history', hist + "%");
    setWidth('fill-strategy', strat + "%");
    setTxt('confidence-value', hist + "%");
    setTxt('score-confidence-ui', strat + "%");

    const rEl = document.getElementById('val-rarity');
    if (rEl) {
        rEl.textContent = rarity.label;
        rEl.className   = `text-xs font-black uppercase ${rarity.class}`;
        const dimNames  = { parity: 'Paridade', highlow: 'Alto/Baixo', sums: 'Soma',
                            primes: 'Primos', sequences: 'Sequência', moldura: 'Moldura', repeats: 'Repetidas' };
        const tipLines  = Object.entries(sigQui2.dims)
            .sort((a, b) => a[1].p - b[1].p)
            .map(([d, v]) => (dimNames[d] || d) + ': p=' + v.p + ' (' + v.freq + '%)');
        rEl.title = tipLines.join('\n');
    }
    
    const pEl = document.getElementById('val-popularity');
    if(pEl) { pEl.textContent = riskLabel; pEl.className = `text-xs font-black uppercase ${riskClass}`; }

    // F3.5 — Índice de Coesão de Pares
    const coeEl = document.getElementById('val-coesao');
    if (coeEl) {
        if (coOcorrenciaData && coOcorrenciaData.chiMatrix && nums.length === 15) {
            const rawChi = calcularCoesaoPares(nums, coOcorrenciaData.chiMatrix);
            let coesaoTxt, coesaoClass;
            if      (rawChi >= 5)  { coesaoTxt = `MUITO COESO (χ²̅=${rawChi.toFixed(1)})`; coesaoClass = 'text-emerald-700'; }
            else if (rawChi >= 2)  { coesaoTxt = `COESO (χ²̅=${rawChi.toFixed(1)})`;      coesaoClass = 'text-emerald-600'; }
            else if (rawChi >= 0.5){ coesaoTxt = `NEUTRO (χ²̅=${rawChi.toFixed(1)})`;     coesaoClass = 'text-gray-500';    }
            else                   { coesaoTxt = `DISPERSO (χ²̅=${rawChi.toFixed(1)})`; coesaoClass = 'text-orange-500';  }
            coeEl.textContent = coesaoTxt;
            coeEl.className   = `text-xs font-black uppercase ${coesaoClass}`;
            coeEl.title       = 'Média do χ² dos 105 pares do jogo. >5: forte atração | 2-5: atração moderada | <0.5: repulsão';
        } else {
            coeEl.textContent = nums.length < 15 ? 'Selecione 15 dezenas' : 'Base não carregada';
            coeEl.className   = 'text-xs font-black uppercase text-gray-400';
        }
    }

    // F3.11 — Diversidade de Cluster (Jaccard)
    const divEl = document.getElementById('val-diversidade');
    if (divEl) {
        if (clusterData && nums.length === 15) {
            const { clustersPresentes, indice } = calcularDiversidadeCluster(nums, clusterData.assignments, clusterData.clusters.length);
            let divTxt, divClass;
            if      (indice >= 80) { divTxt = `MUITO DIVERSO (${indice}%, ${clustersPresentes}g)`; divClass = 'text-violet-700'; }
            else if (indice >= 55) { divTxt = `DIVERSO (${indice}%, ${clustersPresentes}g)`;        divClass = 'text-violet-600'; }
            else if (indice >= 35) { divTxt = `CONCENTRADO (${indice}%, ${clustersPresentes}g)`;    divClass = 'text-amber-600';  }
            else                   { divTxt = `CLUSTER ÚNICO (${indice}%, ${clustersPresentes}g)`;  divClass = 'text-orange-500'; }
            divEl.textContent = divTxt;
            divEl.className   = `text-xs font-black uppercase ${divClass}`;
            divEl.title       = `O jogo cobre ${clustersPresentes} de ${clusterData.clusters.length} grupos Jaccard. Índice: entropia de Shannon normalizada.`;
        } else {
            divEl.textContent = nums.length < 15 ? 'Selecione 15 dezenas' : 'Base não carregada';
            divEl.className   = 'text-xs font-black uppercase text-gray-400';
        }
    }

    let covScore = cov.score !== undefined ? cov.score : cov;
    let covDesc = "Boa cobertura e diversidade";
    
    if (mySavedGames.length === 0) {
        covDesc = "Salve jogos para analisar a cobertura";
    } else if (typeof cov === 'object') {
        if (cov.coveragePerc < 70 && cov.maxOverlap > 10) covDesc = `Baixa cobertura (${cov.coveragePerc}%) e repete ${cov.maxOverlap} dez.`;
        else if (cov.coveragePerc < 70) covDesc = `Baixa cobertura total (${cov.coveragePerc}%)`;
        else if (cov.maxOverlap > 10) covDesc = `Muita repetição (sobrepõe ${cov.maxOverlap} dez.)`;
        else if (cov.coveragePerc >= 85 && cov.maxOverlap <= 9) covDesc = `Ótima cobertura (${cov.coveragePerc}%) e diversidade`;
        else covDesc = `Cobertura média (${cov.coveragePerc}%), repetição aceitável`;
    } else {
        if (covScore < 50) covDesc = "Baixa cobertura ou muita repetição";
        else if (covScore < 80) covDesc = "Cobertura média, repetição moderada";
    }
    
    setTxt('val-coverage', `${covScore}% - ${covDesc}`);

    const tierEl = document.getElementById('score-tier');
    if(tierEl) {
        let tier = "Baixa aderência"; let color = "#ef4444";
        if (strat >= 90) { tier = "Aderência muito alta"; color = "#6366f1"; }
        else if (strat >= 80) { tier = "Alta aderência"; color = "#10b981"; }
        else if (strat >= 65) { tier = "Aderência intermediária"; color = "#fbbf24"; }
        tierEl.textContent = tier; tierEl.style.backgroundColor = color + "22"; tierEl.style.color = color;
    }

    let exp = "Popularidade estimada por regras, sem dados de apostas do público. ";
    exp += covScore < 50 ? "Você está repetindo muitas dezenas nos salvos." : "Boa diversificação de conjunto.";
    setTxt('score-explanation', exp);

    const pos = [], neg = [];
    if (pop < 30) pos.push("Baixo padrão humano (anti-crowd)");
    if (covScore > 70) pos.push("Alta Diversidade de Conjunto");
    if (hist > 80) pos.push("Forte Aderência Histórica");
    if (pop > 60) neg.push("Jogo Muito Óbvio (Risco Rateio)");
    if (hist < 60) neg.push("Desvio Matemático Alto");
    if (coOcorrenciaData && coOcorrenciaData.chiMatrix && nums.length === 15) {
        const rawChi2 = calcularCoesaoPares(nums, coOcorrenciaData.chiMatrix);
        if (rawChi2 >= 3)  pos.push("Alta coocorrência histórica dos pares");
        if (rawChi2 < 0.5) neg.push("Baixa coocorrência histórica dos pares");
    }
    
    const posEl = document.getElementById('score-positives');
    if(posEl) posEl.innerHTML = pos.map(p => `<li>• ${p}</li>`).join('');
    const negEl = document.getElementById('score-negatives');
    if(negEl) negEl.innerHTML = neg.map(n => `<li>• ${n}</li>`).join('');
}

function resetMetrics() {
    const setTxt = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };
    const setHtml = (id, html) => { const el = document.getElementById(id); if(el) el.innerHTML = html; };
    const setWidth = (id, w) => { const el = document.getElementById(id); if(el) el.style.width = w; };

    setTxt('score-history', "--");
    setTxt('score-strategy', "--");
    setWidth('fill-history', "0%");
    setWidth('fill-strategy', "0%");
    setTxt('score-tier', "Aguardando");
    setTxt('score-explanation', "Selecione o volante.");
    setHtml('score-positives', "");
    setHtml('score-negatives', "");
    setTxt('score-confidence-ui', "0%");
    setTxt('confidence-value', "0%");
    setTxt('val-rarity', "Calculando...");
    setTxt('val-popularity', "Calculando...");
    setTxt('val-coesao', "Selecione 15 dezenas");
    setTxt('val-diversidade', "Selecione 15 dezenas");
    setTxt('val-coverage', "0% - Selecione dezenas ou salve jogos");
}

function updateMetricRow(id, val, status) {
    const el = document.getElementById(`val-${id}`); const s = document.getElementById(`status-${id}`);
    if (el) el.textContent = val;
    if (s) {
        if(status === "IDEAL") { s.textContent = '🟢 ADERENTE À REGRA'; s.className = 'status-badge status-ok'; }
        else if(status === "ACEITÁVEL") { s.textContent = '🟡 ACEITÁVEL'; s.className = 'status-badge status-medio'; }
        else { s.textContent = '🔴 FORA PADRÃO'; s.className = 'status-badge status-alert'; }
    }
}

function updateSpatialDistribution(nums) {
    const rows = [0,0,0,0,0], cols = [0,0,0,0,0], quads = [0,0,0,0];
    nums.forEach(n => {
        rows[Math.floor((n-1)/5)]++; cols[(n-1)%5]++;
        if (QUADRANTS.Q1.includes(n)) quads[0]++; else if (QUADRANTS.Q2.includes(n)) quads[1]++; else if (QUADRANTS.Q3.includes(n)) quads[2]++; else if (QUADRANTS.Q4.includes(n)) quads[3]++;
    });
    let allQuadsOk = true;
    const qEl = document.getElementById('dist-quads');
    if(qEl) qEl.innerHTML = quads.map((v, i) => { if (v >= RULES.quad_warn) allQuadsOk = false; return `<div class="p-1.5 rounded bg-gray-50 border border-gray-100 flex flex-col justify-center"><p class="text-[7px] text-gray-400 uppercase font-black">Q${i+1}</p><p class="text-[12px] font-black ${v >= RULES.quad_warn ? 'text-red-500' : 'text-gray-700'}">${v}</p></div>`; }).join('');
    const rowEl = document.getElementById('dist-rows'); if(rowEl) rowEl.textContent = "LINHAS: " + rows.join('|');
    const colEl = document.getElementById('dist-cols'); if(colEl) colEl.textContent = "COLS: " + cols.join('|');
    const overallClassEl = document.getElementById('overall-class');
    if (overallClassEl) overallClassEl.style.display = !allQuadsOk ? 'block' : 'none';
    return allQuadsOk;
}

function checkHistoricalHitsFast(currentMask) {
    const hits = { 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 }; const winners = { 13: [], 14: [], 15: [] };
    for(let i=0; i<database.length; i++) {
        const m = bitCount(currentMask & database[i].mask); if (m >= 11) hits[m]++; if (m >= 13) winners[m].push(database[i].id);
    }
    for (let i = 11; i <= 15; i++) {
        const el = document.getElementById(`hits-${i}`); if (el) { el.textContent = hits[i]; el.classList.toggle('text-emerald-400', hits[i] > 0); }
    }
    [15, 14, 13].forEach(points => {
        const listEl = document.getElementById(`list-hits-${points}`); const contentEl = document.getElementById(`content-${points}`);
        if (listEl && contentEl) {
            if (winners[points].length > 0) { listEl.classList.remove('hidden'); contentEl.innerHTML = winners[points].map(id => `<span class="hit-list-item">${sanitizeHTML(String(id))}</span>`).join(''); }
            else listEl.classList.add('hidden');
        }
    });
    const noWinners = document.getElementById('no-winners'); if (noWinners) noWinners.classList.toggle('hidden', hits[13] > 0 || hits[14] > 0 || hits[15] > 0);
}

function saveCurrentGame() {
    if (selectedNumbers.size < 15) return;
    const nums = Array.from(selectedNumbers).sort((a,b) => a - b);
    
    // Verificação de duplicatas
    const currentStr = nums.join(',');
    const isDuplicate = mySavedGames.some(g => g.nums.join(',') === currentStr);
    
    if (isDuplicate) {
        showToast('⚠️ Este jogo exato já está salvo na sua lista!', 'warning');
        return;
    }

    const scoreVal = document.getElementById('score-strategy').textContent;
    mySavedGames.unshift({ id: Date.now(), nums, date: new Date().toLocaleString('pt-BR'), score: scoreVal, count: nums.length });
    
    systemCache.savedGamesHash = '';

    // F4.3 — Persiste no IndexedDB (primario) e localStorage (backup)
    const novoJogo = mySavedGames[0];
    salvar('savedGames', novoJogo)
        .then(() => { renderSavedGames(); showToast('✅ Jogo salvo estrategicamente!', 'success'); })
        .catch(() => { showToast('Erro ao salvar jogo no banco local.', 'error'); });
    try { localStorage.setItem('lotoSavedGames', JSON.stringify(mySavedGames)); } catch(e) {}
    updateAnalysis();
}

function renderSavedGames() {
    const container = document.getElementById('saved-games-container');
    if (container) {
        // Ordena por quantidade de dezenas (maior primeiro), mantendo a ordem original para empates
        const sortedGames = [...mySavedGames].sort((a, b) => {
            if (b.nums.length !== a.nums.length) {
                return b.nums.length - a.nums.length;
            }
            // Se a quantidade de dezenas for a mesma, mantém a ordem cronológica (mais recentes primeiro, que é o padrão do unshift)
            return b.id - a.id;
        });

        container.innerHTML = sortedGames.map(g => `
        <div class="saved-game-card flex flex-col justify-between h-full">
            <div>
                <div class="flex justify-between items-center mb-3">
                    <span class="text-[9px] font-black text-gray-400 uppercase tracking-widest">${sanitizeHTML(String(g.date ?? ''))}</span>
                    <span class="text-[9px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded border border-indigo-100 shadow-sm">Score: ${sanitizeHTML(String(g.score ?? '--'))}</span>
                </div>
                <div class="flex flex-wrap gap-1.5 mb-4 p-2.5 bg-gray-50 rounded-xl border border-gray-100">
                    ${g.nums.map(n => `<span class="w-7 h-7 flex items-center justify-center bg-white border border-gray-200 shadow-sm rounded-md text-[10px] text-gray-700 font-black">${n.toString().padStart(2, '0')}</span>`).join('')}
                </div>
            </div>
            <div class="flex justify-between items-center pt-3 border-t border-gray-50 gap-2">
                <button onclick="loadSavedGame('${String(g.id).replace(/[^a-zA-Z0-9_-]/g, '')}')" class="flex-1 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 rounded-lg font-black text-[9px] uppercase tracking-widest transition-colors flex items-center justify-center gap-1.5">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path></svg>
                    Carregar no Simulador
                </button>
                <button onclick="removeSavedGame('${String(g.id).replace(/[^a-zA-Z0-9_-]/g, '')}')" title="Excluir Jogo" class="px-3.5 py-2 bg-red-50 hover:bg-red-100 text-red-500 rounded-lg font-black transition-colors flex items-center justify-center">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </div>
        </div>`).join('');
    }
    const sc = document.getElementById('saved-count'); if(sc) sc.textContent = mySavedGames.length;
    const em = document.getElementById('empty-saved-msg'); if(em) em.classList.toggle('hidden', mySavedGames.length > 0);
}

function removeSavedGame(id) {
    // Removido o window.confirm() pois popups nativos são bloqueados pelo ambiente do iFrame
    
    mySavedGames = mySavedGames.filter(g => String(g.id) !== String(id));
    systemCache.savedGamesHash = ''; // Invalida o cache para forcar recalculo da diversidade

    // F4.3 — Remove do IndexedDB (primario) e sincroniza localStorage (backup)
    deletar('savedGames', Number(id)).catch(() => {});
    try { localStorage.setItem('lotoSavedGames', JSON.stringify(mySavedGames)); } catch(e) {}
    renderSavedGames();
    
    if (selectedNumbers.size > 0) updateAnalysis(); 
}

function loadSavedGame(id) {
    // Força conversão para String para garantir a busca exata
    const game = mySavedGames.find(g => String(g.id) === String(id));
    if (!game) return;

    clearBoard(); // Limpa o simulador atual
    
    // Preenche com os números salvos
    game.nums.forEach(n => {
        selectedNumbers.add(n);
        const el = document.getElementById(`num-${n}`);
        if (el) { el.classList.add('selected'); el.setAttribute('aria-pressed', 'true'); }
    });

    updateAnalysis(); // Recalcula os scores do volante
    switchTab('simulador'); // Leva o usuário de volta para a aba Simulador
    window.scrollTo(0, 0);
}

function loadGameToSimulator(numsArray) {
    if (!numsArray || numsArray.length === 0) return;
    
    clearBoard(); // Limpa o simulador atual
    
    // Preenche com os números recebidos do array
    numsArray.forEach(n => {
        selectedNumbers.add(n);
        const el = document.getElementById(`num-${n}`);
        if (el) { el.classList.add('selected'); el.setAttribute('aria-pressed', 'true'); }
    });

    updateAnalysis(); // Recalcula os scores do volante
    switchTab('simulador'); // Leva o usuário para a aba Simulador
    window.scrollTo(0, 0); // Sobe a página
}

function exportGamesToTxt(separator = ',') {
    if (mySavedGames.length === 0) return;
    
    // Ordena os jogos do maior para o menor antes de exportar
    const sortedGames = [...mySavedGames].sort((a, b) => b.nums.length - a.nums.length);
    
    // Monta o TXT com o separador parametrizado
    const content = sortedGames.map(game => game.nums.map(n => n.toString().padStart(2, '0')).join(separator)).join('\n');
    
    const blob = new Blob([content], { type: 'text/plain' }); 
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); 
    a.href = url; 
    
    // Ajusta o nome do arquivo para indicar o formato
    const formato = separator === ',' ? 'virgula' : 'espaco';
    a.download = `jogos_estrategicos_${formato}.txt`; 
    
    a.click();
    URL.revokeObjectURL(url);
}

function exportBackup() {
    const backupData = {
        version: "3.0",
        timestamp: new Date().toISOString(),
        rawData: document.getElementById('raw-data').value,
        database: database,
        historicalStandards: historicalStandards,
        savedGames: mySavedGames
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `loto_backup_${new Date().getTime()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    console.log("✅ [Backup] Todos os dados exportados com sucesso.");
}

function processImportBackup(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            
            // VALIDAÇÃO DA ESTRUTURA DA BASE DE DADOS (DATABASE)
            let validDatabase = [];
            if (imported.database && Array.isArray(imported.database)) {
                validDatabase = imported.database.filter(game => {
                    if (!game.id || !game.nums || !Array.isArray(game.nums) || game.nums.length !== 15 || typeof game.mask !== 'number') return false;
                    const parsedNums = game.nums.map(Number);
                    if (parsedNums.some(n => isNaN(n) || !Number.isInteger(n) || n < 1 || n > 25)) return false;
                    const uniqueSet = new Set(parsedNums);
                    if (uniqueSet.size !== 15) return false;
                    return true;
                });
            }
            
            if (validDatabase.length === 0) {
                showToast('❌ Ficheiro de backup inválido ou sem concursos válidos.', 'error');
                event.target.value = ''; 
                return;
            }

            // VALIDAÇÃO DA ESTRUTURA DOS JOGOS SALVOS
            let validSavedGames = [];
            if (imported.savedGames && Array.isArray(imported.savedGames)) {
                validSavedGames = imported.savedGames.filter(game => {
                    if (!game.nums || !Array.isArray(game.nums)) return false;
                    if (game.nums.length < 15 || game.nums.length > 18) return false;
                    const parsedNums = game.nums.map(Number);
                    if (parsedNums.some(n => isNaN(n) || !Number.isInteger(n) || n < 1 || n > 25)) return false;
                    const uniqueSet = new Set(parsedNums);
                    if (uniqueSet.size !== game.nums.length) return false;
                    return true;
                });
            }

            // VALIDAÇÃO DOS PADRÕES (FALLBACK SE CORROMPIDO)
            let validStandards = imported.historicalStandards;
            if (!validStandards || typeof validStandards !== 'object' || !validStandards.sums) {
                validStandards = {
                    sums: { ideal: null, acceptable: [] },
                    repeats: { ideal: null, acceptable: [] },
                    parity: { ideal: null, acceptable: [] },
                    highlow: { ideal: null, acceptable: [] },
                    primes: { ideal: null, acceptable: [] },
                    sequence: { ideal: null, acceptable: [] },
                    moldura: { ideal: null, acceptable: [] },
                    spatial: true
                };
            }
            
            showConfirmModal(
                '⚠️ ATENÇÃO: Deseja substituir TODOS os dados atuais (histórico, jogos salvos e padrões) por este backup? Esta ação não pode ser desfeita.',
                () => {
                document.getElementById('loading-overlay').style.display = 'flex';
                
                setTimeout(async () => {
                    // 1. Restaurar variáveis para memória apenas com os dados filtrados e validados
                    database = validDatabase;
                    internalGamesPanel.invalidate();
                    historicalStandards = validStandards;
                    mySavedGames = validSavedGames;
                    
                    const text = imported.rawData || "";
                    document.getElementById('raw-data').value = text;
                    
                    // 2. Persistir no LocalStorage
                    try {
                        localStorage.setItem('lotoRawData', text);
                        localStorage.setItem('lotoDatabase', JSON.stringify(database));
                        localStorage.setItem('lotoStandards', JSON.stringify(historicalStandards));
                        localStorage.setItem('lotoSavedGames', JSON.stringify(mySavedGames));
                    } catch(e) {
                        if (e.name === 'QuotaExceededError') showToast('Erro: armazenamento local cheio. Backup restaurado em memória, mas não persistido.', 'error');
                    }
                    
                    // 3. Invalidar caches globais
                    systemCache.tableHtml = null;
                    systemCache.heatmap.dbLength = 0;
                    systemCache.dist.dbLength = 0;
                    systemCache.savedGamesHash = '';
                    coOcorrenciaData = null;
                    clusterData      = null;
                    
                    // 4. Recalcular métricas dependentes e ecrã
                    const tc = document.getElementById('total-contests');
                    if(tc) tc.textContent = database.length;
                    
                    await calculateCoincidencesFast();
                    coOcorrenciaData = calcularMatrizCoOcorrencia(database);
                    clusterData      = clusterizarJaccard(coOcorrenciaData.coMatrix, coOcorrenciaData.freqs);
                    updateHeatmapAndDelays();
                    updateAnalysisRange(0);
                    gerarDistribuicoesHistoricas(); // Auto-reconstrói os padrões caso o backup os tenha trazido vazios/falhos
                    renderSavedGames();
                    updateAnalysis();
                    
                    document.getElementById('loading-overlay').style.display = 'none';
                    showToast(`✅ Backup restaurado! ${database.length} concursos, ${mySavedGames.length} jogos.`, 'success');
                    console.log(`✅ [Backup] Dados restaurados (Base: ${database.length}, Jogos: ${mySavedGames.length}).`);
                }, 50);
                }
            );
        } catch (err) {
            showToast('❌ Erro ao ler ficheiro: conteúdo JSON corrompido.', 'error');
            console.warn(`⚠️ [Backup] Falha na leitura: ${err.message}`);
        }
        event.target.value = ''; // Reset ao input para permitir carregar o mesmo ficheiro se necessário
    };
    reader.readAsText(file);
}

function parseSavedGameLine(line) {
    const cleaned = line.trim();
    if (!cleaned) return null;
    const numbers = cleaned.split(/[\s,;]+/).filter(Boolean).map(Number);
    if (numbers.length < 15 || numbers.length > 18) return null;
    if (numbers.some(n => isNaN(n) || !Number.isInteger(n) || n < 1 || n > 25)) return null;
    const unique = [...new Set(numbers)];
    if (unique.length !== numbers.length) return null;
    return unique.sort((a, b) => a - b);
}

function processImportSavedGames(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const lines = String(e.target.result).split(/\r?\n/);
        const imported = [];
        const duplicates = [];

        lines.forEach(line => {
            const nums = parseSavedGameLine(line);
            if (!nums) return;
            const key = nums.join(',');
            if (mySavedGames.some(g => g.nums.join(',') === key) || imported.some(g => g.nums.join(',') === key)) {
                duplicates.push(key);
                return;
            }
            imported.push({
                id: Date.now() + imported.length,
                nums,
                date: new Date().toLocaleString('pt-BR'),
                score: '--',
                count: nums.length
            });
        });

        if (imported.length === 0) {
            showToast('Nenhum jogo válido encontrado no arquivo.', 'error');
            event.target.value = '';
            return;
        }

        mySavedGames.unshift(...imported);
        systemCache.savedGamesHash = '';

        salvarLote('savedGames', imported).catch(() => {});
        try { localStorage.setItem('lotoSavedGames', JSON.stringify(mySavedGames)); } catch(e) {}
        renderSavedGames();
        showToast(`✅ Importados ${imported.length} jogos${duplicates.length ? ' (' + duplicates.length + ' duplicados ignorados)' : ''}`, 'success');
        event.target.value = '';
    };
    reader.readAsText(file);
}

async function importHistory() {
    const text = document.getElementById('raw-data').value.trim(); if (!text) return;
    document.getElementById('loading-overlay').style.display = 'flex';
    setTimeout(async () => {
        const lines = text.split('\n'); const newDb = [];
        let validCount = 0; let invalidCount = 0;

        lines.forEach(l => {
            const lineStr = l.trim();
            if (!lineStr) return; // ignora linhas vazias sem contar como erro

            const separatorIndex = lineStr.indexOf('-');
            if (separatorIndex === -1) { invalidCount++; return; } // Sem separador '-'

            const idPart = lineStr.substring(0, separatorIndex).trim();
            const numsPart = lineStr.substring(separatorIndex + 1).trim();

            if (!idPart || !numsPart || !/\d/.test(idPart)) { invalidCount++; return; } // ID inválido (sem números) ou dezenas ausentes

            const rawTokens = numsPart.split(/[,;\s]+/).filter(s => s.trim() !== '');
            if (rawTokens.length !== 15) { invalidCount++; return; } // Faltam ou sobram dezenas

            const parsedNums = rawTokens.map(Number);
            if (parsedNums.some(n => isNaN(n) || !Number.isInteger(n) || n < 1 || n > 25)) { invalidCount++; return; } // Letras, decimais ou fora de 1-25

            const uniqueNums = new Set(parsedNums);
            if (uniqueNums.size !== 15) { invalidCount++; return; } // Dezenas repetidas no mesmo concurso

            // Impede a inserção de concursos com o mesmo ID (duplicatas)
            if (newDb.some(game => game.id === idPart)) { invalidCount++; return; }

            // Se passou por todas as barreiras, o jogo é 100% válido
            const nums = Array.from(uniqueNums).sort((a,b) => a - b);
            const m1 = nums.reduce((m, n) => m | (1 << (n - 1)), 0);
            newDb.push({ id: idPart, nums, sum: nums.reduce((a,b) => a + b, 0), mask: m1, maxSeq: getMaxSequence(nums) });
            validCount++;
        });

        database = newDb;
        internalGamesPanel.invalidate(); 
        
        // NOVO: Limpa os caches para forçar o recálculo completo da nova base
        systemCache.tableHtml = null;
        systemCache.heatmap.dbLength = 0;
        systemCache.dist.dbLength = 0;
        coOcorrenciaData = null;
        clusterData      = null;
        markovData       = null;

        await calculateCoincidencesFast();
        coOcorrenciaData = calcularMatrizCoOcorrencia(database);
        clusterData      = clusterizarJaccard(coOcorrenciaData.coMatrix, coOcorrenciaData.freqs);
        markovData       = construirMatrizTransicao(database);
        
        const tc = document.getElementById('total-contests');
        if(tc) tc.textContent = database.length;
        
        updateHeatmapAndDelays(); updateAnalysisRange(0);
        gerarDistribuicoesHistoricas();
        
        // Persiste a base APÓS todos os cálculos serem concluídos
        try {
            localStorage.setItem('lotoRawData', text);
            localStorage.setItem('lotoDatabase', JSON.stringify(database));
            localStorage.setItem('lotoStandards', JSON.stringify(historicalStandards));
        } catch(e) {
            if (e.name === 'QuotaExceededError') showToast('Erro: armazenamento local cheio. Os dados foram processados mas não foram salvos para a próxima sessão.', 'error');
        }

        // F4.6 -- Persiste concursos na store contests do IndexedDB
        const _tsImportacao = Date.now();
        salvarLote('contests', database.map(c => ({ id: c.id, nums: c.nums, dataImportacao: _tsImportacao }))).catch(() => {});
        
        document.getElementById('loading-overlay').style.display = 'none';

        const tipo = invalidCount > 0 ? 'warning' : 'success';
        const msg = invalidCount > 0
            ? `✅ ${validCount} concursos importados — ⚠️ ${invalidCount} linhas ignoradas.`
            : `✅ ${validCount} concursos importados com sucesso.`;
        showToast(msg, tipo);
    }, 50);
}

async function calculateCoincidencesFast() {
    const len = database.length;
    if (len === 0 || (database[0].maxCoincidence !== undefined && database[0].maxCoincidence12Count !== undefined)) return;
    const masks = database.map(c => ({ id: c.id, mask: c.mask }));
    const worker = new Worker(new URL('./workers/coincidences.worker.js', import.meta.url));
    await new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
            if (e.data.type === 'result') {
                e.data.results.forEach((r, i) => {
                    database[i].maxCoincidence = r.maxCoincidence;
                    database[i].maxCoincidenceCount = r.maxCoincidenceCount;
                    database[i].maxCoincidence12Count = r.maxCoincidence12Count;
                });
                worker.terminate();
                resolve();
            }
        };
        worker.onerror = (err) => { worker.terminate(); reject(err); };
        worker.postMessage(masks);
    });
}

function updateAnalysisRange(range) {
    const list = (range === 0 || range > database.length) ? database : database.slice(0, range);
    const body = document.getElementById('history-table-body');
    const arl = document.getElementById('active-range-label');
    if(arl) arl.textContent = range === 0 ? "Tudo" : `Últimos ${range}`;
    
    let sumCoinc = 0;
    let sumCoinc12 = 0;
    for(let i=0; i<list.length; i++) {
        sumCoinc += list[i].maxCoincidence || 0;
        sumCoinc12 += list[i].maxCoincidence12Count || 0;
    }
    const avgCoinc = list.length > 0 ? (sumCoinc / list.length).toFixed(1) : "0.0";
    const avg12Coinc = list.length > 0 ? (sumCoinc12 / list.length).toFixed(1) : "0.0";
    const avgEl = document.getElementById('avg-max-coinc');
    const avg12El = document.getElementById('avg-max-coinc-12');
    if (avgEl) avgEl.textContent = avgCoinc;
    if (avg12El) avg12El.textContent = avg12Coinc;
    
    const cacheKey = `range_${range}_db_${database.length}`;
    if (systemCache.tableHtml && systemCache.tableHtml.key === cacheKey) {
        if (body) body.innerHTML = systemCache.tableHtml.html;
    } else {
        let rowsHtml = [];
        for(let i=0; i<list.length; i++) {
            const c = list[i];
            let rep = 0; 
            const dbIdx = i; // Substitui o indexOf pesado (que causava lentidão O(n^2)) por acesso direto à memória (O(1))
            if (dbIdx < database.length - 1) { rep = bitCount(c.mask & database[dbIdx+1].mask); }
            rowsHtml.push(`<tr class="border-b border-gray-50"><td class="p-3 font-bold text-gray-300 tracking-tighter">${c.id}</td><td class="p-3 text-center text-[10px] text-gray-500 font-mono">${c.nums.map(n => n.toString().padStart(2,'0')).join(' ')}</td><td class="p-3 text-center font-bold text-blue-600">${rep || '-'}</td><td class="p-3 text-center font-bold text-purple-600">${c.sum}</td><td class="p-3 text-center font-black text-orange-500">${c.maxCoincidence} <span class="text-[9px] text-gray-400">(${c.maxCoincidenceCount}x)</span></td><td class="p-3 text-center font-bold text-teal-600">${c.maxCoincidence12Count != null ? c.maxCoincidence12Count : '-'}</td><td class="p-3 text-center ${c.maxSeq > 7 ? 'text-red-600' : ''}"><div class="flex items-center justify-center gap-2"><span>${c.maxSeq}</span><button onclick="loadGameToSimulator([${c.nums.join(',')}])" class="px-2 py-1 text-[10px] font-black uppercase rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Simular</button></div></td></tr>`);
        }
        const finalHtml = rowsHtml.join('');
        systemCache.tableHtml = { key: cacheKey, html: finalHtml };
        if (body) body.innerHTML = finalHtml;
    }
    document.querySelectorAll('.range-btn').forEach(b => b.classList.toggle('active', b.id === `range-${range}`));
}

// switchTab inline — versão definitiva (com ARIA) em js/ui/tabs.js (migrar em F1.8)
function switchTab(tab) {
    const TABS = ['simulador', 'meus-jogos', 'analise', 'dados', 'conexoes', 'sniper'];
    TABS.forEach(t => {
        const el  = document.getElementById(`tab-${t}`);
        const btn = document.getElementById(`btn-tab-${t}`);
        const isActive = t === tab;
        if (el) el.classList.toggle('hidden', !isActive);
        if (btn) {
            btn.classList.remove('active', 'active-conexoes');
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            btn.setAttribute('tabindex',      isActive ? '0'   : '-1');
            if (isActive) {
                btn.classList.add('active');
                if (t === 'conexoes') btn.classList.add('active-conexoes');
            }
        }
    });
    if (tab === 'meus-jogos') renderSavedGames();
    if (tab === 'conexoes')   runConexao13Analysis();
}

/* 🚀 FUNÇÃO ADAPTADA: SELETOR DE MODO DE CONEXÃO */
function changeConexaoMode(mode) {
    conexaoMode = mode;
    
    // Atualiza botões
    document.getElementById('btn-mode-12').classList.toggle('active', mode === 12);
    document.getElementById('btn-mode-13').classList.toggle('active', mode === 13);
    
    // Recalcula apenas esta aba
    runConexao13Analysis();
}

/* 🚀 FUNÇÃO ISOLADA: AFINIDADES ESTRUTURAIS (12/13 PONTOS) */
function runConexao13Analysis() {
    const container = document.getElementById('conexoes-results');
    const counterEl = document.getElementById('connections-count');
    const permaEl = document.getElementById('behavior-permanencia');
    const entryEl = document.getElementById('behavior-entrada');
    const exitEl = document.getElementById('behavior-saida');
    const genBtn = document.getElementById('btn-gen-structured');
    
    if (!container) return;

    // Feedback de processamento
    container.innerHTML = `
        <div class="col-span-full text-center py-20">
            <div class="inline-block w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p class="text-xs font-black text-pink-600 uppercase tracking-widest">Mapeando afinidades de ${conexaoMode} pontos...</p>
        </div>
    `;

    // Timeout para não travar a UI durante o cálculo pesado
    setTimeout(() => {
        if (database.length < 2) {
            container.innerHTML = '<div class="col-span-full text-center py-20 text-gray-300 italic">Base de dados insuficiente para mapeamento.</div>';
            return;
        }

        let pairs = [];
        // Acumuladores de comportamento
        let freqPermanencia = new Array(26).fill(0); // Ponto comum
        let freqEntrada = new Array(26).fill(0);    // Ponto variável (entrada/saída mútua)
        let freqSaida = new Array(26).fill(0);      // Ausente em ambos

        // Analisa o histórico de forma otimizada (usa base carregada com teto de 4500)
        const limit = Math.min(database.length, 4500);

        for (let i = 0; i < limit; i++) {
            const c1 = database[i];
            for (let j = i + 1; j < limit; j++) {
                const c2 = database[j];
                const coincidence = bitCount(c1.mask & c2.mask);
                
                if (coincidence === conexaoMode) {
                    pairs.push({ c1, c2 });
                    
                    // Calcula comportamento para este par específico
                    for (let n = 1; n <= 25; n++) {
                        const inC1 = c1.nums.includes(n);
                        const inC2 = c2.nums.includes(n);
                        
                        if (inC1 && inC2) freqPermanencia[n]++;
                        else if (inC1 || inC2) freqEntrada[n]++;
                        else freqSaida[n]++;
                    }
                }
            }
        }

        counterEl.textContent = pairs.length;
        const choose=(n,k)=>{let v=1;for(let j=1;j<=k;j++)v=v*(n-j+1)/j;return v;};
        const expected=limit*(limit-1)/2*choose(15,conexaoMode)*choose(10,15-conexaoMode)/choose(25,15);
        document.getElementById('connections-baseline').textContent=
            'Pares observados: '+pairs.length.toLocaleString('pt-BR')+
            ' · Esperados sob sorteios uniformes independentes: '+expected.toLocaleString('pt-BR',{maximumFractionDigits:1})+
            '. A quantidade de conexões, isoladamente, não comprova previsão.';

        // Salva em cache para o gerador estruturado
        lastConexaoAnalysis.perma = freqPermanencia.map((v, i) => ({ n: i, v })).filter(x => x.n > 0).sort((a,b) => b.v - a.v);
        lastConexaoAnalysis.entry = freqEntrada.map((v, i) => ({ n: i, v })).filter(x => x.n > 0).sort((a,b) => b.v - a.v);
        lastConexaoAnalysis.exit = freqSaida.map((v, i) => ({ n: i, v })).filter(x => x.n > 0).sort((a,b) => b.v - a.v);

        // NOVO: Aciona a análise cronológica passando apenas a base de pares filtrada pelo modo (12 ou 13)
        runTransitionAnalysis(pairs);

        // Renderiza Resumo de Comportamento (Top 8 de cada categoria)
        const renderBehavior = (targetEl, data, colorClass) => {
            const sorted = [...data].slice(0, 8);
            targetEl.innerHTML = sorted.map(item => `
                <div class="flex flex-col items-center gap-1">
                    <div class="behavior-ball ${colorClass} text-white">${item.n.toString().padStart(2, '0')}</div>
                    <span class="text-[7px] font-black text-gray-400">${item.v}x</span>
                </div>
            `).join('');
        };

        if (pairs.length > 0) {
            if(genBtn) genBtn.classList.remove('hidden');
            renderBehavior(permaEl, lastConexaoAnalysis.perma, 'bg-pink-500');
            renderBehavior(entryEl, lastConexaoAnalysis.entry, 'bg-indigo-600');
            renderBehavior(exitEl, lastConexaoAnalysis.exit, 'bg-gray-400');
            
            container.innerHTML = pairs.map(p => `
                <div class="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm connection-card hover:shadow-md transition-shadow">
                    <div class="flex justify-between items-center mb-3">
                        <span class="text-[10px] font-black text-pink-500 bg-pink-50 px-2 py-1 rounded">PAR #${p.c1.id} + #${p.c2.id}</span>
                        <span class="text-[8px] font-bold text-gray-400 uppercase italic">Afinidade: ${conexaoMode}/15</span>
                    </div>
                    <div class="flex flex-wrap gap-1 mb-3">
                        ${Array.from({length: 25}, (_, i) => i + 1).map(n => {
                            const isMatch = p.c1.nums.includes(n) && p.c2.nums.includes(n);
                            if (!isMatch) return '';
                            return `<span class="w-6 h-6 flex items-center justify-center bg-gray-900 text-white rounded-md text-[9px] font-black">${n.toString().padStart(2,'0')}</span>`;
                        }).join('')}
                    </div>
                    <div class="border-t border-gray-50 pt-2 flex justify-between items-center">
                        <span class="text-[8px] font-black text-gray-400 uppercase">Diferença de tempo:</span>
                        <span class="text-[8px] font-bold text-gray-500">${Math.abs(parseInt(p.c1.id) - parseInt(p.c2.id))} concursos</span>
                    </div>
                </div>
            `).join('');
        } else {
            if(genBtn) genBtn.classList.add('hidden');
            permaEl.innerHTML = '<span class="text-[9px] text-gray-300 italic">Sem dados</span>';
            entryEl.innerHTML = '<span class="text-[9px] text-gray-300 italic">Sem dados</span>';
            exitEl.innerHTML = '<span class="text-[9px] text-gray-300 italic">Sem dados</span>';
            container.innerHTML = `<div class="col-span-full text-center py-20 text-gray-300 italic">Nenhum par com exatamente ${conexaoMode} pontos encontrado na amostra recente.</div>`;
        }
    }, 50);
}

/* 🚀 NOVA FUNÇÃO ISOLADA: ANÁLISE DE TRANSIÇÃO (N-1 -> N) */
function runTransitionAnalysis() {
    const summaryEl=document.getElementById('transition-summary');
    if(!summaryEl)return;
    const data=summarizeTransitions(database);
    document.getElementById('transition-sample').textContent=data.total+' transições válidas.';
    const labels={repeats:'Repetição mais observada',sums:'Soma mais observada',parity:'Quantidade de pares',highlow:'Quantidade de baixos',primes:'Quantidade de primos',sequence:'Maior sequência'};
    summaryEl.replaceChildren();
    for(const [key,label] of Object.entries(labels)) {
        const options=Object.entries(data.counts[key]).sort((a,b)=>b[1]-a[1]);
        const top=options[0], card=document.createElement('div');
        card.className='bg-gray-50 border border-gray-100 p-3 rounded-2xl';
        const title=document.createElement('p');title.className='text-sm text-slate-600';title.textContent=label;
        const value=document.createElement('p');value.className='font-bold text-indigo-700';
        value.textContent=top?options.filter(x=>x[1]===top[1]).map(x=>x[0]).join(' / '):'Sem dados';
        const note=document.createElement('p');note.className='text-xs text-slate-600';
        note.textContent=top?top[1]+'/'+data.total+' transições ('+(100*top[1]/data.total).toFixed(2)+'% cada)':'Importe concursos consecutivos.';
        card.append(title,value,note);summaryEl.append(card);
    }
    for(const [kind,id] of [['entry','trans-entries'],['exit','trans-exits']]) {
        const ranked=data[kind].map((v,n)=>({n,v})).slice(1).sort((a,b)=>b.v-a.v);
        lastConexaoAnalysis[kind==='entry'?'transEntry':'transExit']=ranked;
        const target=document.getElementById(id);target.replaceChildren();
        for(const item of ranked.slice(0,10)) {
            const span=document.createElement('span');span.className='text-sm font-bold text-slate-700 p-2';
            span.textContent=String(item.n).padStart(2,'0')+': '+item.v+' vezes';
            target.append(span);
        }
    }
}

/* 🎯 NOVO GERADOR ESTRUTURADO (CONEXÕES) */
function generateStructuredConexaoGame() {
    if (lastConexaoAnalysis.perma.length === 0) return;
    
    document.getElementById('loading-overlay').style.display = 'flex';
    
    setTimeout(() => {
        clearBoard();
        
        const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);
        
        // 1. Filtra pools de candidatos
        const nucleusPool = lastConexaoAnalysis.perma.slice(0, 12).map(x => x.n);
        const rotationPool = lastConexaoAnalysis.entry.slice(0, 10).map(x => x.n);
        const transEntryPool = (lastConexaoAnalysis.transEntry || []).slice(0, 8).map(x => x.n);
        const exclusionPool = (lastConexaoAnalysis.exit || []).slice(0, 8).map(x => x.n);
        
        let bestGame = [];
        let bestScore = -1;
        
        // Validação Estrutural Mínima
        const validateGame = (nums) => {
            const sum = nums.reduce((a, b) => a + b, 0);
            const evens = nums.filter(n => n % 2 === 0).length;
            const maxSeq = getMaxSequence(nums);
            
            let score = 0; let valid = true;
            if (sum >= 170 && sum <= 220) score += 3; else valid = false;
            if (evens >= 6 && evens <= 9) score += 3; else valid = false;
            if (maxSeq <= 5) score += 2; else valid = false;
            
            return { valid, score };
        };

        // Tenta encontrar a combinação ideal
        for (let attempt = 0; attempt < 200; attempt++) {
            const gameResult = new Set();
            
            // Seleção Estratégica Baseada nas Regras
            const nucCount = 6 + Math.floor(Math.random() * 3); // 6 a 8 do Núcleo
            const rotCount = 4 + Math.floor(Math.random() * 2); // 4 a 5 da Rotação
            const transCount = 2 + Math.floor(Math.random() * 2); // 2 a 3 da Entrada Cronológica
            
            shuffle([...nucleusPool]).slice(0, nucCount).forEach(n => gameResult.add(n));
            shuffle(rotationPool.filter(n => !gameResult.has(n))).slice(0, rotCount).forEach(n => gameResult.add(n));
            shuffle(transEntryPool.filter(n => !gameResult.has(n))).slice(0, transCount).forEach(n => gameResult.add(n));
            
            // Completa até 15 evitando as piores exclusões (Zona de Saída)
            if (gameResult.size < 15) {
                const allAvail = Array.from({length: 25}, (_, i) => i + 1).filter(n => !gameResult.has(n));
                const safeAvail = allAvail.filter(n => !exclusionPool.includes(n));
                
                const fillPool = safeAvail.length >= (15 - gameResult.size) ? safeAvail : allAvail;
                shuffle(fillPool).slice(0, 15 - gameResult.size).forEach(n => gameResult.add(n));
            }
            
            // Garante exatamente 15 dezenas (corta excesso se os sorteios sobrepuserem as 15)
            const candidate = Array.from(gameResult).slice(0, 15).sort((a, b) => a - b);
            
            if (candidate.length === 15) {
                const { valid, score } = validateGame(candidate);
                if (valid) { bestGame = candidate; break; } // Jogo perfeito encontrado, para o loop
                if (score > bestScore) { bestScore = score; bestGame = candidate; } // Salva o mais próximo do ideal
            }
        }
        
        // Aplica o melhor jogo validado encontrado ao volante
        if (bestGame.length === 15) {
            bestGame.forEach(n => {
                selectedNumbers.add(n);
                const el = document.getElementById(`num-${n}`);
                if (el) { el.classList.add('selected'); el.setAttribute('aria-pressed', 'true'); }
            });
        }
        
        updateAnalysis();
        switchTab('simulador');
        document.getElementById('loading-overlay').style.display = 'none';
        console.log(`✨ [Gerador Afinidade] Jogo validado estruturalmente gerado com base em afinidade de ${conexaoMode} pts.`);
    }, 500);
}

function clearBoard() {
    selectedNumbers.clear();
    internalGamesPanel.invalidate();
    document.querySelectorAll('.ball').forEach(b => { b.classList.remove('selected'); b.setAttribute('aria-pressed', 'false'); });
    localStorage.removeItem('lotoCurrentBoard');
    resetMetrics();
}

function _smartHashSeed(...parts) {
    let h = 2166136261 >>> 0;
    const text = parts.join('|');
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h || 1;
}

function _smartSeededRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function _getSmartAutoCalibration() {
    const recentSignature = database.slice(0, 80)
        .map(c => `${c?.id ?? ''}:${Array.isArray(c?.nums) ? c.nums.join('.') : ''}`)
        .join('|');
    const dbKey = `${database.length}|${_smartHashSeed(recentSignature)}`;
    if (systemCache.smartAuto.dbKey === dbKey && systemCache.smartAuto.calibration) {
        return systemCache.smartAuto.calibration;
    }
    const calibration = calibrateSmartWeightsCore(database, {
        window: 16,
        candidateCount: 160,
        gamesCount: 1,
        minHistory: 50,
        regularization: 0.12,
        passes: 2,
        factors: [0.70, 1.30],
        minGain: 0.003,
        rngFactory: (i, contest) => _smartSeededRng(_smartHashSeed(contest?.id, 'live-auto-calibration', i, database.length))
    });
    systemCache.smartAuto = { dbKey, calibration };
    return calibration;
}

function generateSmartGame(qty = 15) {
    if (database.length === 0) return;
    if (qty !== 15) {
        showToast('O Smart compartilhado foi calibrado para jogos de 15 dezenas.', 'warning');
        return;
    }
    document.getElementById('loading-overlay').style.display = 'flex';
    setTimeout(() => {
        clearBoard();

        // Smart Engine v4: pesos calibrados em nested walk-forward usando apenas
        // concursos já conhecidos. Se a calibração interna não melhorar o baseline,
        // o guard rail mantém os pesos fixos originais.
        const calibration = _getSmartAutoCalibration();
        const bestGame = getHeadlessSmartGameCore(database, mySavedGames, {
            iterations: 1400,
            coverageWeight: mySavedGames.length ? 0.10 : 0,
            weights: calibration.weights,
        });

        const info = document.getElementById('smart-auto-status');
        if (info) {
            const changed = calibration.changed ? 'pesos ajustados' : 'baseline preservado';
            info.textContent = `Auto-calibração: ${calibration.rounds} concursos internos · ${changed}`;
        }

        if (Array.isArray(bestGame) && bestGame.length === 15) {
            bestGame.forEach(n => {
                selectedNumbers.add(n);
                const el = document.getElementById(`num-${n}`);
                if (el) { el.classList.add('selected'); el.setAttribute('aria-pressed', 'true'); }
            });
        }

        updateAnalysis();
        document.getElementById('loading-overlay').style.display = 'none';
    }, 50);
}

function generateFocusedGame(numCount, targetMaxCoinc) {
    if (database.length === 0) return;
    document.getElementById('loading-overlay').style.display = 'flex';
    setTimeout(() => {
        clearBoard();
        let bestCandidate = null;
        let bestAllowedCandidate = null;
        let bestAllowedMaxMatch = -1;
        let minDiff = 999;

        for (let i = 0; i < 3000; i++) {
            const current = [];
            const pool = Array.from({length: 25}, (_, i) => i + 1);
            while (current.length < numCount) current.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
            const mask = current.reduce((m, n) => m | (1 << (n - 1)), 0);

            let maxMatch = 0;
            for (let j = 0; j < database.length; j++) {
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

        const finalCandidate = bestAllowedCandidate || bestCandidate;
        if (finalCandidate) finalCandidate.forEach(n => {
            selectedNumbers.add(n);
            const el = document.getElementById(`num-${n}`);
            if (el) { el.classList.add('selected'); el.setAttribute('aria-pressed', 'true'); }
        });

        updateAnalysis();
        document.getElementById('loading-overlay').style.display = 'none';
    }, 50);
}

function generateStrictFocusedGame(numCount, targetMaxCoinc) {
    if (database.length === 0) return;
    document.getElementById('loading-overlay').style.display = 'flex';
    setTimeout(() => {
        clearBoard();

        const masks = database.map(c => c.mask);
        const countExactMatches = (nums, target) => {
            const mask = nums.reduce((m, n) => m | (1 << (n - 1)), 0);
            let count = 0;
            for (let j = 0; j < masks.length; j++) {
                if (bitCount(mask & masks[j]) === target) count++;
            }
            return count;
        };
        const maxOverlap = nums => {
            const mask = nums.reduce((m, n) => m | (1 << (n - 1)), 0);
            let maxMatch = 0;
            for (let j = 0; j < masks.length; j++) {
                const m = bitCount(mask & masks[j]);
                if (m > maxMatch) maxMatch = m;
            }
            return maxMatch;
        };
        const getBase15 = () => getHeadlessFocusedGame(targetMaxCoinc, database);

        const base15 = getBase15();
        if (!base15 || base15.length !== 15) {
            showToast('Não foi possível gerar um jogo base de 15 números com Máx 12.', 'warning');
            document.getElementById('loading-overlay').style.display = 'none';
            return;
        }

        const unused = Array.from({ length: 25 }, (_, i) => i + 1).filter(n => !base15.includes(n));
        const shuffledUnused = unused.sort(() => Math.random() - 0.5).slice(0, Math.min(9, unused.length));

        let bestCandidate = null;
        let bestCount13 = Infinity;
        let bestMaxMatch = Infinity;

        for (const extra of shuffledUnused) {
            const candidate = [...base15, extra];
            const count13 = countExactMatches(candidate, 13);
            const maxMatch = maxOverlap(candidate);
            if (count13 < bestCount13 || (count13 === bestCount13 && maxMatch < bestMaxMatch)) {
                bestCount13 = count13;
                bestMaxMatch = maxMatch;
                bestCandidate = candidate;
            }
        }

        if (bestCandidate) {
            bestCandidate.forEach(n => {
                selectedNumbers.add(n);
                const el = document.getElementById(`num-${n}`);
                if (el) { el.classList.add('selected'); el.setAttribute('aria-pressed', 'true'); }
            });
            showToast(`16 (Máx 12): melhor extra gerado com ${bestCount13} jogos de 13 coincidências (máx ${bestMaxMatch}).`, 'success');
            console.log('16 max 12 candidate:', bestCandidate.join(','), '13 coincidências:', bestCount13, 'maxMatch:', bestMaxMatch);
        } else {
            showToast('Não foi possível gerar uma extensão de 16 números a partir do jogo 15 Máx 12.', 'warning');
        }

        updateAnalysis();
        document.getElementById('loading-overlay').style.display = 'none';
    }, 50);
}

function evaluateCandidate(nums) {
    const count = nums.length;
    const currentMask = nums.reduce((m, n) => m | (1 << (n - 1)), 0);
    const evens = nums.filter(n => n % 2 === 0).length;
    const lows = nums.filter(n => n <= 13).length;
    const sum = nums.reduce((a,b) => a + b, 0);
    const primes = nums.filter(n => PRIMES.includes(n)).length;
    const frame = nums.filter(n => FRAME.includes(n)).length;
    const maxSeq = getMaxSequence(nums);
    const valSoma = `${Math.floor(sum / 10) * 10}-${Math.floor(sum / 10) * 10 + 9}`;
    const valRepeatNum = database.length > 0 ? bitCount(currentMask & database[0].mask) : 0;
    const valRepeat = `${valRepeatNum} Repetidas`;
    const valParity = `${evens}P / ${count-evens}Í`;
    const valHL = `${lows}B / ${count-lows}A`;
    const valPrimes = `${primes} Primos`;
    const valSeq = `Seq. de ${maxSeq}`;
    const valFrame = `${frame} Moldura`;
    const quads = [0,0,0,0];
    nums.forEach(n => { if (QUADRANTS.Q1.includes(n)) quads[0]++; else if (QUADRANTS.Q2.includes(n)) quads[1]++; else if (QUADRANTS.Q3.includes(n)) quads[2]++; else if (QUADRANTS.Q4.includes(n)) quads[3]++; });
    const spatialOk = !quads.some(v => v >= RULES.quad_warn);
    const getStatus = (std, currentVal) => { if(std.ideal === currentVal) return "IDEAL"; if(std.acceptable.includes(currentVal)) return "ACEITÁVEL"; return "FORA"; };
    const metrics = { sum: getStatus(historicalStandards.sums, valSoma), repeat: getStatus(historicalStandards.repeats, valRepeat), parity: getStatus(historicalStandards.parity, valParity), highlow: getStatus(historicalStandards.highlow, valHL), primes: getStatus(historicalStandards.primes, valPrimes), sequence: getStatus(historicalStandards.sequence, valSeq), frame: getStatus(historicalStandards.moldura, valFrame), spatial: spatialOk ? "IDEAL" : "FORA" };
    const historicalScore = calculateAdherenceScore(metrics);
    const humanPopularity = calculateHumanPopularity(nums);
    const coverageData = calculateCoverageQuality(nums);
    const coverageScore = coverageData.score !== undefined ? coverageData.score : coverageData;
    return { strategicScore: Math.round((historicalScore * scoreWeights.h) + ((100 - humanPopularity) * scoreWeights.p) + (Math.min(100, coverageScore * 2.5) * scoreWeights.c)), historicalScore, humanPopularity, coverageScore };
}

function optimizeCurrentGame() {
    const currentCount = selectedNumbers.size; if (currentCount < 15) return;
    document.getElementById('loading-overlay').style.display = 'flex';
    setTimeout(() => { 
        const currentNums = Array.from(selectedNumbers).sort((a,b) => a - b);
        let bestNums = [...currentNums]; let bestScore = evaluateCandidate(bestNums);
        const allNums = Array.from({length: 25}, (_, i) => i + 1);
        for (let i = 0; i < 2000; i++) {
            let candidate = [...bestNums]; const swaps = Math.floor(Math.random() * 3) + 1;
            for (let s = 0; s < swaps; s++) {
                const removeIdx = Math.floor(Math.random() * candidate.length);
                candidate.splice(removeIdx, 1);
                const available = allNums.filter(n => !candidate.includes(n));
                candidate.push(available[Math.floor(Math.random() * available.length)]);
            }
            candidate.sort((a,b) => a - b);
            const candidateScore = evaluateCandidate(candidate);
            const betterStrategy = candidateScore.strategicScore > bestScore.strategicScore;
            const tieBreak = (candidateScore.strategicScore === bestScore.strategicScore && candidateScore.historicalScore > bestScore.historicalScore);
            const popOk = candidateScore.humanPopularity <= bestScore.humanPopularity || candidateScore.humanPopularity <= 35;
            const COVOK = candidateScore.coverageScore >= bestScore.coverageScore || candidateScore.coverageScore >= 80;
            if ((betterStrategy || tieBreak) && popOk && COVOK) { bestNums = [...candidate]; bestScore = candidateScore; }
        }
        if (bestNums.join(',') !== currentNums.join(',')) {
            clearBoard(); bestNums.forEach(n => { selectedNumbers.add(n); const el = document.getElementById(`num-${n}`); if (el) { el.classList.add('selected'); el.setAttribute('aria-pressed', 'true'); } });
            updateAnalysis();
        }
        document.getElementById('loading-overlay').style.display = 'none'; 
    }, 50);
}

function calculateCandidateRarity(nums) {
    return getSignificanciaQui2(nums).overall;
}
function evaluatePremiumCandidate(candidateNums) {
    const baseMetrics = evaluateCandidate(candidateNums);
    const rarityMetrics = calculateCandidateRarity(candidateNums);
    return { nums: [...candidateNums], strategicScore: baseMetrics.strategicScore, historicalScore: baseMetrics.historicalScore, humanPopularity: baseMetrics.humanPopularity, coverageScore: baseMetrics.coverageScore, rarityLabel: rarityMetrics.label, rarityLevel: rarityMetrics.level };
}

// F2.1 — EMA (λ=0.95) substitui contagem simples dos últimos 10 concursos.
// Processa do mais antigo (database[length-1]) ao mais recente (database[0]),
// dando peso exponencialmente maior aos concursos mais recentes.
// Com 100+ concursos, EMA converge para a frequência real: ema_k ≈ p*(1−λ^k).
const EMA_LAMBDA = 0.95;

// F2.2 — Z-score do atraso por número.
// Para cada número n, coleta todos os intervalos entre aparições consecutivas
// (inter-arrival gaps), calcula μ e σ históricos e retorna:
//   z_n = (atraso_atual − μ_n) / σ_n
// Z positivo → número está "devendo" mais do que o normal.
// Z negativo → apareceu mais recentemente do que o esperado.
// Requer ≥ 3 gaps para ter σ significativo; retorna null caso contrário.
// F2.4 — Tendência temporal: regressão linear OLS numa janela deslizante de TREND_WINDOW concursos.
// slope > TREND_THRESHOLD  → ↗ (frequência crescente nos últimos concursos)
// slope < -TREND_THRESHOLD → ↘ (frequência decrescente)
// |slope| ≤ TREND_THRESHOLD → estável
const TREND_WINDOW    = 30;
const TREND_THRESHOLD = 0.01;

function calcularTendencias(db, windowSize = TREND_WINDOW) {
    const trends = {};
    const n = Math.min(windowSize, db.length);
    if (n < 5) { for (let i = 1; i <= 25; i++) trends[i] = 0; return trends; }
    // x = posição cronológica: x=0 → concurso mais antigo da janela (db[n-1])
    //                          x=n-1 → concurso mais recente (db[0])
    const sumX  = (n * (n - 1)) / 2;
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    const denom = n * sumX2 - sumX * sumX;
    for (let num = 1; num <= 25; num++) {
        let sumY = 0, sumXY = 0;
        for (let x = 0; x < n; x++) {
            const y = db[n - 1 - x].nums.includes(num) ? 1 : 0;
            sumY  += y;
            sumXY += x * y;
        }
        trends[num] = denom !== 0 ? +((n * sumXY - sumX * sumY) / denom).toFixed(5) : 0;
    }
    return trends;
}

function calcularZScoreAtrasos(db, currentDelays) {
    const zScores = {};
    for (let n = 1; n <= 25; n++) {
        // Coleta índices onde n aparece (0 = concurso mais recente)
        const gaps = [];
        let lastIdx = -1;
        for (let i = 0; i < db.length; i++) {
            if (db[i].nums.includes(n)) {
                if (lastIdx >= 0) gaps.push(i - lastIdx);
                lastIdx = i;
            }
        }
        if (gaps.length < 3) { zScores[n] = null; continue; }

        const mu = gaps.reduce((s, g) => s + g, 0) / gaps.length;
        const variance = gaps.reduce((s, g) => s + (g - mu) ** 2, 0) / gaps.length;
        const sigma = Math.sqrt(variance);

        if (sigma < 0.001) { zScores[n] = 0; continue; }

        zScores[n] = +((currentDelays[n] - mu) / sigma).toFixed(2);
    }
    return zScores;
}

function updateHeatmapAndDelays() {
    if (database.length === 0) return;
    let counts, delays, zScores, trends;
    if (systemCache.heatmap.dbLength === database.length && systemCache.heatmap.counts) {
        counts  = systemCache.heatmap.counts;
        delays  = systemCache.heatmap.delays;
        zScores = systemCache.heatmap.zScores;
        trends  = systemCache.heatmap.trends;
    } else {
        // ── EMA: inicializa em 0 e percorre do mais antigo ao mais recente ──
        counts = {};
        for (let i = 1; i <= 25; i++) counts[i] = 0;
        for (let i = database.length - 1; i >= 0; i--) {
            for (let n = 1; n <= 25; n++) {
                const present = database[i].nums.includes(n) ? 1 : 0;
                counts[n] = EMA_LAMBDA * counts[n] + (1 - EMA_LAMBDA) * present;
            }
        }

        // ── Atrasos: quantos concursos desde a última aparição ──
        delays = {};
        for (let i = 1; i <= 25; i++) {
            let d = 0;
            for (let j = 0; j < database.length; j++) { if (database[j].nums.includes(i)) break; d++; }
            delays[i] = d;
        }

        // ── Z-score dos atrasos (F2.2) ──
        zScores = calcularZScoreAtrasos(database, delays);

        // F2.4 — Tendência temporal via regressão linear (janela deslizante)
        trends = calcularTendencias(database);

        systemCache.heatmap = { counts, delays, zScores, trends, dbLength: database.length };
    }

    for (let i = 1; i <= 25; i++) {
        const el = document.getElementById(`num-${i}`);
        const delayEl = document.getElementById(`delay-${i}`);
        if (!el || !delayEl) continue;
        el.classList.remove('heat-hot', 'heat-medium', 'heat-cold', 'bg-white');
        // EMA já está em [0, 1] — mesmos limiares visuais de antes
        const freq = counts[i];
        if (freq >= 0.65) el.classList.add('heat-hot');
        else if (freq >= 0.45) el.classList.add('heat-medium');
        else el.classList.add('heat-cold');
        if (delays[i] > 0) { delayEl.textContent = delays[i]; delayEl.style.display = 'flex'; }
        else delayEl.style.display = 'none';

        // F2.3 — Tooltip com Z-score (sinal ↑↓→ + valor)
        const z = zScores ? zScores[i] : null;
        if (z !== null && z !== undefined) {
            const sign  = z >= 1.5 ? '↑' : z <= -1.5 ? '↓' : '→';
            const label = z >= 1.5 ? 'Atrasado' : z <= -1.5 ? 'Recente' : 'Normal';
            const zStr  = (z >= 0 ? '+' : '') + z.toFixed(2);
            el.setAttribute('data-z', `${sign} z=${zStr} · ${label}`);
        } else {
            el.removeAttribute('data-z');
        }

        // F2.4 — Seta de tendência temporal (regressão linear)
        const trendEl = document.getElementById(`trend-${i}`);
        if (trendEl && trends) {
            const slope = trends[i];
            if (slope > TREND_THRESHOLD) {
                trendEl.textContent = '↗'; trendEl.className = 'trend-badge trend-up';
            } else if (slope < -TREND_THRESHOLD) {
                trendEl.textContent = '↘'; trendEl.className = 'trend-badge trend-down';
            } else {
                trendEl.textContent = ''; trendEl.className = 'trend-badge';
            }
        }
    }
}

function gerarDistribuicoesHistoricas() {
    if (database.length === 0) return;
    const baseCount = database.length;
    let stats, sumsMap;
    if (systemCache.dist.dbLength === baseCount && systemCache.dist.stats) { stats = systemCache.dist.stats; sumsMap = systemCache.dist.sumsMap; if (systemCache.dist.dynWeights) DYNAMIC_WEIGHTS = systemCache.dist.dynWeights; } else {
        stats = { parity: {}, highlow: {}, sums: {}, primes: {}, sequences: {}, repeats: {}, moldura: {}, rows: {}, cols: {} }; sumsMap = { parity: 0, highlow: 0, sums: 0, primes: 0, sequences: 0, repeats: 0, moldura: 0 };
        database.forEach((c, idx) => {
            const evens = c.nums.filter(n => n % 2 === 0).length; stats.parity[`${evens}P / ${15-evens}Í`] = (stats.parity[`${evens}P / ${15-evens}Í`] || 0) + 1; sumsMap.parity += evens;
            const lows = c.nums.filter(n => n <= 13).length; stats.highlow[`${lows}B / ${15-lows}A`] = (stats.highlow[`${lows}B / ${15-lows}A`] || 0) + 1; sumsMap.highlow += lows;
            const sumBin = Math.floor(c.sum / 10) * 10; stats.sums[`${sumBin}-${sumBin + 9}`] = (stats.sums[`${sumBin}-${sumBin + 9}`] || 0) + 1; sumsMap.sums += c.sum;
            const pCount = c.nums.filter(n => PRIMES.includes(n)).length; stats.primes[`${pCount} Primos`] = (stats.primes[`${pCount} Primos`] || 0) + 1; sumsMap.primes += pCount;
            const seq = c.maxSeq; stats.sequences[`Seq. de ${seq}`] = (stats.sequences[`Seq. de ${seq}`] || 0) + 1; sumsMap.sequences += seq;
            if (idx < baseCount - 1) { const rep = bitCount(c.mask & database[idx + 1].mask); stats.repeats[`${rep} Repetidas`] = (stats.repeats[`${rep} Repetidas`] || 0) + 1; sumsMap.repeats += rep; }
            const fCount = c.nums.filter(n => FRAME.includes(n)).length; stats.moldura[`${fCount} Moldura`] = (stats.moldura[`${fCount} Moldura`] || 0) + 1; sumsMap.moldura += fCount;
            
            let r = [0,0,0,0,0], col = [0,0,0,0,0];
            c.nums.forEach(n => { r[Math.floor((n-1)/5)]++; col[(n-1)%5]++; });
            const rStr = r.join('-'); const cStr = col.join('-');
            stats.rows[rStr] = (stats.rows[rStr] || 0) + 1;
            stats.cols[cStr] = (stats.cols[cStr] || 0) + 1;
        });
        const extractStds = (d) => { const s = Object.entries(d).sort((a,b) => b[1] - a[1]); return { ideal: s[0] ? s[0][0] : null, acceptable: s.slice(1, 5).map(e => e[0]) }; };
        historicalStandards.sums = extractStds(stats.sums); historicalStandards.repeats = extractStds(stats.repeats); historicalStandards.parity = extractStds(stats.parity); historicalStandards.highlow = extractStds(stats.highlow); historicalStandards.primes = extractStds(stats.primes); historicalStandards.sequence = extractStds(stats.sequences); historicalStandards.moldura = extractStds(stats.moldura);
        updateDynamicWeights(stats, baseCount); systemCache.dist = { dbLength: baseCount, stats, sumsMap, dynWeights: DYNAMIC_WEIGHTS };
    }
    
    // ATUALIZADO: renderPro agora entende a natureza estatística de dispersão de matrizes longas (isPattern)
    const renderPro = (t, d, dom, av, ai, isPattern = false) => { 
        const s = Object.entries(d).sort((a,b) => b[1] - a[1]); 
        const t7 = s.slice(0, 7); 
        const el = document.getElementById(t); 
        if(el) el.innerHTML = t7.map(([l, c], i) => `<div class="freq-item ${i === 0 ? 'dominant' : ''}"><span class="freq-label">${l}</span><span class="freq-count">${c} <span class="text-[8px] opacity-40">(${((c/baseCount)*100).toFixed(1)}%)</span></span></div>`).join(''); 
        const aiEl = document.getElementById(ai); 
        if(aiEl) aiEl.textContent = av !== null && av !== undefined ? av.toFixed(1) : '--'; 
        
        const tp = (t7[0][1] / baseCount) * 100; 
        let dc = "dom-fraco", dt = "Disperso"; 
        
        // Limites estatísticos adaptados (Linhas/Colunas se diluem em milhares de combinações, logo % menores indicam padrões fortes)
        const limitHigh = isPattern ? 15 : 30;
        const limitMed = isPattern ? 8 : 20;

        if(tp >= limitHigh) { dc = "dom-forte"; dt = "Frequente na base"; } 
        else if(tp >= limitMed) { dc = "dom-medio"; dt = "Padrão Médio"; } 
        
        const domEl = document.getElementById(dom); 
        if(domEl) domEl.innerHTML = `<span class="dom-indicator ${dc}">${dt}</span>`; 
    };
    
    renderPro('freq-sums', stats.sums, 'dom-sums', sumsMap.sums/baseCount, 'avg-sums'); 
    renderPro('freq-repeats', stats.repeats, 'dom-repeats', sumsMap.repeats/(baseCount-1), 'avg-repeats'); 
    renderPro('freq-parity', stats.parity, 'dom-parity', sumsMap.parity/baseCount, 'avg-parity'); 
    renderPro('freq-highlow', stats.highlow, 'dom-highlow', sumsMap.highlow/baseCount, 'avg-highlow'); 
    renderPro('freq-primes', stats.primes, 'dom-primes', sumsMap.primes/baseCount, 'avg-primes'); 
    renderPro('freq-sequence', stats.sequences, 'dom-sequence', sumsMap.sequences/baseCount, 'avg-sequence'); 
    renderPro('freq-moldura', stats.moldura, 'dom-moldura', sumsMap.moldura/baseCount, 'avg-moldura');
    
    renderPro('freq-rows', stats.rows, 'dom-rows', null, null, true);
    renderPro('freq-cols', stats.cols, 'dom-cols', null, null, true);

    // ATUALIZADO: Leitura inteligente da estrutura espacial baseada em formato real do vetor
    const analyzePattern = (patternStr) => {
        if(!patternStr) return { text: "Indefinida", color: "text-gray-400" };
        const vals = patternStr.split('-').map(Number);
        const max = Math.max(...vals);
        const min = Math.min(...vals);
        if(max >= 5 || min === 0) return { text: "Agressiva (Vazios/Cheios)", color: "text-red-500" };
        if(max === 4) return { text: "Concentrada (Foco)", color: "text-orange-500" };
        return { text: "Equilibrada (Plana)", color: "text-emerald-500" };
    };

    const topRow = Object.entries(stats.rows).sort((a,b) => b[1] - a[1])[0];
    if(topRow) { 
        const el = document.getElementById('disp-rows'); 
        const analysis = analyzePattern(topRow[0]);
        if(el) { el.textContent = analysis.text; el.className = `text-[10px] font-black ${analysis.color}`; } 
    }
    
    const topCol = Object.entries(stats.cols).sort((a,b) => b[1] - a[1])[0];
    if(topCol) { 
        const el = document.getElementById('disp-cols'); 
        const analysis = analyzePattern(topCol[0]);
        if(el) { el.textContent = analysis.text; el.className = `text-[10px] font-black ${analysis.color}`; } 
    }

    // Volume observado da base. Não é exibido como "confiança" porque frequência histórica
    // não equivale a probabilidade preditiva.
    const brEl = document.getElementById('base-reliability');
    if (brEl) brEl.textContent = `${baseCount} conc.`;
    const fillEl = document.getElementById('base-reliability-fill');
    if (fillEl) fillEl.style.width = '0%';

    const interpEl = document.getElementById('base-interpretation');
    if (interpEl) {
        const topParity = Object.entries(stats.parity).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'Indefinido';
        const topHL = Object.entries(stats.highlow).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'Indefinido';
        const topSum = Object.entries(stats.sums).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'Indefinido';
        const sampleNote = baseCount < 50
            ? 'A amostra é pequena; trate os padrões como descritivos.'
            : baseCount < 200
                ? 'A amostra permite descrever padrões, mas não prova capacidade de previsão.'
                : 'A base é ampla para descrição histórica; qualquer vantagem preditiva ainda precisa vencer o controle aleatório no Sniper.';

        interpEl.innerHTML = `Com <strong>${baseCount}</strong> concursos processados, os agrupamentos mais frequentes nesta base são <strong>${sanitizeHTML(topParity)}</strong>, <strong>${sanitizeHTML(topHL)}</strong> e soma <strong>${sanitizeHTML(topSum)}</strong>. ${sampleNote}`;
    }

}

/* ==========================================
   MOTOR SNIPER (BACKTEST HEADLESS)
   ========================================== */

// Walk-Forward: deriva limiares estruturais APENAS dos dados anteriores ao ponto de teste,
// eliminando look-ahead bias nos geradores headless.


function getHeadlessFocusedGame(targetMaxCoinc, slicedDb) {
    return getHeadlessFocusedGameCore(targetMaxCoinc, slicedDb);
}



// NOVO: Gerador Headless isolado para a estratégia Smart, mantendo extrema fidelidade



// =============================================================
// _renderBacktestResults  renderiza resultados recebidos do
// Web Worker (ou de qualquer fonte estruturada).
// =============================================================
function _renderBacktestResults(result, strategy, gamesCount) {
    const { totalHits, sumBestHits, validPeriods, allGamesTotal,
            bestHitGlobal, compStats, roundResults, period, baseline, componentImpact, ablationStats, calibrationSummary, focused13Audit, focused13Blocks, executionProfile, elapsedMs } = result;

    const stratLabels = { random:'Aleatório', smart:'Smart Fixo', smartAuto:'Smart Auto', focado12:'Focado 12', focado13:'Focado 15 Máx 13', conexoes:'Conexões 13' };
    const actualStrategy = result.strategy || strategy;
    const setupBadgeName = stratLabels[actualStrategy] || actualStrategy;
    const fmtPct = (v, digits = 3) => Number.isFinite(v) ? (v * 100).toFixed(digits) + '%' : '--';

    // --- HISTÓRICO ---
    let historyHtml = '';
    const visibleRoundResults = (roundResults || []).slice(0, 250);
    visibleRoundResults.forEach(row => {
        const { contestId, contestNums, maxHit, bestGame } = row;
        const safeId = sanitizeHTML(String(contestId));
        const targetStr = (contestNums || []).map(n => Number(n).toString().padStart(2,'0')).join(' ');
        const targetHtml = '<div class="font-black text-gray-700">#' + safeId + '</div>'
            + '<div class="text-[8.5px] font-mono text-gray-400 tracking-tighter mt-0.5" title="Sorteio real">' + targetStr + '</div>';

        const setupBadge = '<span class="bg-gray-100 text-gray-500 px-2 py-1 rounded text-[8px] font-black uppercase tracking-widest border border-gray-200">'
            + sanitizeHTML(setupBadgeName) + ' (' + gamesCount + 'x)</span>';

        let hitClass = 'text-gray-500';
        if      (maxHit === 15) hitClass = 'text-emerald-600';
        else if (maxHit === 14) hitClass = 'text-yellow-600';
        else if (maxHit >= 11)  hitClass = 'text-indigo-600';

        const safeBest = Array.isArray(bestGame) ? bestGame.filter(n => Number.isInteger(n) && n >= 1 && n <= 25) : [];
        const bestGameStr = safeBest.length ? safeBest.map(n => n.toString().padStart(2,'0')).join(' ') : '--';
        let bestGameHtml = '<div class="flex items-center justify-center gap-1.5">'
            + '<div class="text-[10px] font-mono font-bold ' + hitClass + '">' + bestGameStr + '</div>';

        if (safeBest.length) {
            bestGameHtml += '<button onclick="loadGameToSimulator([' + safeBest.join(',') + '])" title="Analisar no Simulador"'
                + ' class="text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded p-1 transition-all">'
                + '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
                + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>'
                + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>'
                + '</svg></button>';
        }
        bestGameHtml += '</div>';
        if (gamesCount > 1) bestGameHtml += '<div class="text-[8px] text-gray-400 mt-1 italic">Melhor de ' + gamesCount + ' jogos</div>';

        const rowBg = maxHit >= 11 ? 'bg-emerald-50/40' : 'bg-white hover:bg-gray-50 transition-colors';
        const sitText = maxHit >= 11
            ? '<span class="text-[9px] text-emerald-600 font-black bg-emerald-100 px-2 py-0.5 rounded uppercase tracking-wider">Premiado</span>'
            : '<span class="text-gray-400">Sem prêmio</span>';

        historyHtml += '<tr class="border-b border-gray-100 ' + rowBg + '">'
            + '<td class="p-3">' + targetHtml + '</td>'
            + '<td class="p-3 text-center">' + setupBadge + '</td>'
            + '<td class="p-3 text-center">' + bestGameHtml + '</td>'
            + '<td class="p-3 text-center font-black text-gray-800 text-sm">' + Number(maxHit || 0) + '</td>'
            + '<td class="p-3 text-center text-[10px]">' + sitText + '</td>'
            + '</tr>';
    });
    if ((roundResults || []).length > visibleRoundResults.length) {
        historyHtml += '<tr><td colspan="5" class="p-4 text-center text-[9px] font-bold text-gray-400 bg-gray-50">Log visual limitado aos 250 concursos mais recentes para manter a interface leve. As métricas acima usam todos os ' + Number(roundResults.length) + ' concursos.</td></tr>';
    }

    // --- COMPARATIVO: inclui apenas estratégias realmente executadas ---
    const executedStrategies = Object.keys(compStats || {}).filter(st => Number(compStats[st]?.validPeriods || 0) > 0);
    let bestCompStrategy = '', maxCompScore = -Infinity;
    executedStrategies.forEach(st => {
        const s = compStats[st];
        const rate13 = Number(s.rate13 || 0);
        const rate12 = s.totalGames ? s.hits12 / s.totalGames : 0;
        const stScore = rate13 * 10000 + rate12 * 1000 + parseFloat(s.avg || 0);
        if (stScore > maxCompScore) { maxCompScore = stScore; bestCompStrategy = st; }
    });

    let compHtml = '<div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">';
    executedStrategies.forEach(st => {
        const s = compStats[st];
        const isBest = st === bestCompStrategy;
        const isControl = st === 'random';
        const borderC = isBest ? 'border-emerald-400 bg-emerald-50/20' : (isControl ? 'border-slate-300 bg-slate-50' : 'border-gray-100 bg-gray-50');
        const titleC = isBest ? 'text-emerald-700' : (isControl ? 'text-slate-700' : 'text-gray-500');
        const badge = isBest
            ? '<div class="bg-emerald-500 text-white text-[7px] font-black uppercase text-center py-0.5">Melhor na amostra</div>'
            : isControl
                ? '<div class="bg-slate-500 text-white text-[7px] font-black uppercase text-center py-0.5">Controle</div>'
                : '<div class="bg-transparent text-transparent text-[7px] font-black py-0.5">.</div>';
        compHtml += '<div class="rounded-xl border ' + borderC + ' flex flex-col overflow-hidden">'
            + badge
            + '<div class="p-2 text-center flex-1 flex flex-col">'
            + '<h4 class="text-[9px] font-black uppercase tracking-tighter mb-1.5 ' + titleC + '">' + sanitizeHTML(s.name) + '</h4>'
            + '<p class="text-[7px] font-bold text-gray-400 uppercase">Melhor/Concurso</p>'
            + '<p class="text-[12px] font-black text-gray-800 mb-2">' + Number(s.avg || 0).toFixed(2) + '</p>'
            + '<div class="grid grid-cols-3 gap-1 mb-2 border-t border-gray-100 pt-2">'
            + '<div><p class="text-[6px] text-gray-400 font-bold uppercase">11+</p><p class="text-[9px] font-black text-indigo-600">' + Number(s.hits11 || 0) + '</p></div>'
            + '<div><p class="text-[6px] text-gray-400 font-bold uppercase">12+</p><p class="text-[9px] font-black text-yellow-600">' + Number(s.hits12 || 0) + '</p></div>'
            + '<div><p class="text-[6px] text-gray-400 font-bold uppercase">13+</p><p class="text-[9px] font-black text-emerald-600">' + Number(s.hits13 || 0) + '</p></div>'
            + '</div>'
            + '<p class="text-[7px] font-bold text-gray-400 uppercase">Taxa 13+: <span class="text-gray-800">' + fmtPct(Number(s.rate13 || 0)) + '</span></p>'
            + '<p class="text-[7px] font-bold text-gray-400 uppercase mt-auto">Melhor: <span class="text-gray-800">' + Number(s.bestHit || 0) + '</span></p>'
            + '</div></div>';
    });
    compHtml += '</div>';
    document.getElementById('sniper-comparative-container').innerHTML = compHtml;

    // --- RAIO-X DO FOCADO 13 / AFINIDADES ---
    const focusedBlock = document.getElementById('sniper-focused13-audit-block');
    const focusedEl = document.getElementById('sniper-focused13-audit-container');
    const focusedNoteEl = document.getElementById('sniper-focused13-audit-note');
    const focusedBlocksBlock = document.getElementById('sniper-focused13-blocks-block');
    const focusedBlocksEl = document.getElementById('sniper-focused13-blocks-container');
    const focusedBlocksNoteEl = document.getElementById('sniper-focused13-blocks-note');
    const smartAuditBlock = document.getElementById('sniper-smart-audit-block');
    const smartCalibrationBlock = document.getElementById('sniper-smart-calibration-block');
    const isFocusedProfile = executionProfile === 'focado13_deep' || actualStrategy === 'focado13';

    if (isFocusedProfile) {
        if (smartAuditBlock) smartAuditBlock.classList.add('hidden');
        if (smartCalibrationBlock) smartCalibrationBlock.classList.add('hidden');
        if (focusedBlock) focusedBlock.classList.remove('hidden');
        if (!focused13Audit && focusedEl) {
            focusedEl.innerHTML = '<div class="col-span-full p-6 text-center text-[9px] font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-2xl">O perfil Focado 13 foi executado, mas o diagnóstico específico não chegou do Worker. A execução foi bloqueada para não misturar métricas do Smart.</div>';
            if (focusedNoteEl) focusedNoteEl.textContent = 'Diagnóstico Focado 13 indisponível nesta execução. Recarregue a v5.1; o app não exibirá métricas de outro motor no lugar.';
        }
    } else {
        if (focusedBlock) focusedBlock.classList.add('hidden');
        if (focusedBlocksBlock) focusedBlocksBlock.classList.add('hidden');
        if (smartAuditBlock) smartAuditBlock.classList.remove('hidden');
        if (smartCalibrationBlock) smartCalibrationBlock.classList.remove('hidden');
    }

    if (isFocusedProfile && focused13Audit && focusedEl) {
        if (focusedBlock) focusedBlock.classList.remove('hidden');
        if (smartAuditBlock) smartAuditBlock.classList.add('hidden');
        if (smartCalibrationBlock) smartCalibrationBlock.classList.add('hidden');
        const variants = focused13Audit.variants || {};
        const fmtDelta = v => (Number(v) >= 0 ? '+' : '') + Number(v || 0).toFixed(3);
        const fmtPP = v => (Number(v) >= 0 ? '+' : '') + (Number(v || 0) * 100).toFixed(2) + ' pp';
        const cards = [
            ['lowAffinity','Afinidade baixa','Escolhe o candidato Máx 13 com menos vínculos históricos de 13 pontos.'],
            ['highAffinity','Afinidade alta','Escolhe o candidato Máx 13 com mais vínculos históricos de 13 pontos.'],
            ['structure','Estrutura histórica','Escolhe o candidato Máx 13 mais aderente a soma, pares e sequência do passado.']
        ];
        let html = '<div class="rounded-2xl border border-pink-200 bg-pink-50/30 p-3">'
            + '<p class="text-[9px] font-black text-pink-700 uppercase">Focado 13 atual</p>'
            + '<p class="text-2xl font-black text-gray-800 mt-1">' + Number(focused13Audit.current?.avg || 0).toFixed(2) + '</p>'
            + '<p class="text-[7px] font-bold text-gray-400 uppercase">melhor/concurso</p>'
            + '<div class="grid grid-cols-2 gap-2 mt-3 text-center">'
            + '<div><p class="text-[7px] text-gray-400 font-bold">12+</p><p class="text-[10px] font-black text-yellow-600">' + ((focused13Audit.current?.rate12 || 0)*100).toFixed(3) + '%</p></div>'
            + '<div><p class="text-[7px] text-gray-400 font-bold">13+</p><p class="text-[10px] font-black text-emerald-600">' + ((focused13Audit.current?.rate13 || 0)*100).toFixed(3) + '%</p></div>'
            + '</div></div>';
        cards.forEach(([key,title,desc]) => {
            const x = variants[key]; if (!x) return;
            let badge='INCONCLUSIVO', cls='bg-gray-100 text-gray-500 border-gray-200', border='border-gray-200';
            if (x.verdict === 'ajudou') { badge='MELHOROU NA AMOSTRA'; cls='bg-emerald-50 text-emerald-700 border-emerald-200'; border='border-emerald-200'; }
            else if (x.verdict === 'atrapalhou') { badge='PIOROU NA AMOSTRA'; cls='bg-rose-50 text-rose-700 border-rose-200'; border='border-rose-200'; }
            html += '<div class="rounded-2xl border ' + border + ' bg-white p-3">'
                + '<div class="flex justify-between gap-2"><div><p class="text-[9px] font-black text-gray-800 uppercase">' + title + '</p><p class="text-[7px] text-gray-400 mt-1">' + desc + '</p></div>'
                + '<span class="h-fit text-[6px] font-black border rounded px-1.5 py-0.5 ' + cls + '">' + badge + '</span></div>'
                + '<div class="grid grid-cols-2 gap-2 mt-3">'
                + '<div class="bg-gray-50 rounded-xl p-2"><p class="text-[7px] font-black text-gray-400 uppercase">Δ vs atual</p><p class="text-sm font-black text-gray-800">' + fmtDelta(x.deltaAvg) + '</p></div>'
                + '<div class="bg-gray-50 rounded-xl p-2"><p class="text-[7px] font-black text-gray-400 uppercase">IC95%</p><p class="text-[9px] font-black text-gray-700">' + Number(x.ciLow||0).toFixed(3) + ' a ' + Number(x.ciHigh||0).toFixed(3) + '</p></div>'
                + '</div><div class="grid grid-cols-2 gap-2 mt-2 text-center">'
                + '<div><p class="text-[7px] text-gray-400 font-bold">Δ 12+</p><p class="text-[9px] font-black text-yellow-600">' + fmtPP(x.deltaRate12) + '</p></div>'
                + '<div><p class="text-[7px] text-gray-400 font-bold">Δ 13+</p><p class="text-[9px] font-black text-emerald-600">' + fmtPP(x.deltaRate13) + '</p></div>'
                + '</div></div>';
        });
        focusedEl.innerHTML = html;
        const vr = focused13Audit.vsRandom || {mean:0,low:0,high:0,n:0};
        const search = focused13Audit.search || {};
        let verdict = vr.low > 0 ? 'o Focado 13 superou o aleatório na média pareada desta amostra' : vr.high < 0 ? 'o Focado 13 ficou abaixo do aleatório nesta amostra' : 'a diferença Focado 13 × Aleatório continua inconclusiva';
        if (focusedNoteEl) focusedNoteEl.innerHTML = '<strong>Regra Máx 13 × aleatório:</strong> Δ ' + fmtDelta(vr.mean) + ' (IC95% ' + Number(vr.low||0).toFixed(3) + ' a ' + Number(vr.high||0).toFixed(3) + '; n=' + Number(vr.n||0) + '): <strong>' + verdict + '.</strong> '
            + 'O audit usa pool de ' + Number(focused13Audit.poolSize||0) + ' candidatos por jogo. Em média, ' + Number(search.avgExactCandidates||0).toFixed(1) + ' candidatos válidos =13 entraram no pool; rejeição por coincidência 14+ foi ' + ((Number(search.reject14Rate||0))*100).toFixed(1) + '%. '
            + 'Afinidade média do atual: ' + Number(search.avgCurrentAffinity||0).toFixed(1) + ' vínculos históricos de 13 pontos. Nenhuma variante vê o concurso-alvo.';
    }

    // --- VALIDAÇÃO POR BLOCOS DE ALVOS NÃO SOBREPOSTOS ---
    if (isFocusedProfile && focusedBlocksBlock) {
        focusedBlocksBlock.classList.remove('hidden');
        if (focused13Blocks && focusedBlocksEl) {
            const fmtRate = v => (Number(v || 0) * 100).toFixed(3) + '%';
            const fmtSigned = v => (Number(v) >= 0 ? '+' : '') + Number(v || 0).toFixed(3);
            const fmtPP = v => (Number(v) >= 0 ? '+' : '') + (Number(v || 0) * 100).toFixed(3) + ' pp';
            let html = '<div class="grid grid-cols-1 md:grid-cols-3 gap-3">';
            (focused13Blocks.blocks || []).forEach(block => {
                const ci = block.pairedAvg || {mean:0,low:0,high:0,n:0};
                let badge='INCONCLUSIVO', badgeClass='bg-gray-100 text-gray-500 border-gray-200';
                if (Number(ci.low) > 0) { badge='MÉDIA POSITIVA'; badgeClass='bg-emerald-50 text-emerald-700 border-emerald-200'; }
                else if (Number(ci.high) < 0) { badge='MÉDIA NEGATIVA'; badgeClass='bg-rose-50 text-rose-700 border-rose-200'; }
                const safeStart=sanitizeHTML(String(block.startContest ?? '--'));
                const safeEnd=sanitizeHTML(String(block.endContest ?? '--'));
                html += '<div class="rounded-2xl border border-slate-200 bg-white p-3">'
                    + '<div class="flex items-start justify-between gap-2"><div><p class="text-[9px] font-black uppercase text-slate-700">Bloco ' + sanitizeHTML(block.label || '') + '</p>'
                    + '<p class="text-[7px] font-bold text-gray-400 mt-1">#' + safeStart + ' → #' + safeEnd + ' · ' + Number(block.targets || 0) + ' alvos</p></div>'
                    + '<span class="text-[6px] font-black border rounded px-1.5 py-0.5 ' + badgeClass + '">' + badge + '</span></div>'
                    + '<div class="grid grid-cols-2 gap-2 mt-3">'
                    + '<div class="bg-pink-50/50 border border-pink-100 rounded-xl p-2 text-center"><p class="text-[7px] font-black text-pink-500 uppercase">Focado 13</p><p class="text-lg font-black text-gray-800">' + Number(block.focado13?.avg || 0).toFixed(2) + '</p><p class="text-[7px] text-gray-400">13+: <strong class="text-emerald-600">' + Number(block.focado13?.hits13 || 0) + '</strong> · ' + fmtRate(block.focado13?.rate13) + '</p></div>'
                    + '<div class="bg-slate-50 border border-slate-100 rounded-xl p-2 text-center"><p class="text-[7px] font-black text-slate-500 uppercase">Aleatório</p><p class="text-lg font-black text-gray-800">' + Number(block.random?.avg || 0).toFixed(2) + '</p><p class="text-[7px] text-gray-400">13+: <strong class="text-slate-700">' + Number(block.random?.hits13 || 0) + '</strong> · ' + fmtRate(block.random?.rate13) + '</p></div>'
                    + '</div>'
                    + '<div class="grid grid-cols-2 gap-2 mt-2">'
                    + '<div class="bg-gray-50 rounded-xl p-2"><p class="text-[7px] font-black text-gray-400 uppercase">Δ média pareada</p><p class="text-sm font-black text-gray-800">' + fmtSigned(ci.mean) + '</p><p class="text-[7px] text-gray-400">IC95% ' + Number(ci.low||0).toFixed(3) + ' a ' + Number(ci.high||0).toFixed(3) + '</p></div>'
                    + '<div class="bg-gray-50 rounded-xl p-2"><p class="text-[7px] font-black text-gray-400 uppercase">Δ taxa 13+</p><p class="text-sm font-black text-emerald-700">' + fmtPP(block.deltaRate13) + '</p><p class="text-[7px] text-gray-400">melhor F13: ' + Number(block.focado13?.bestHit || 0) + '</p></div>'
                    + '</div></div>';
            });
            html += '</div>';
            focusedBlocksEl.innerHTML = html;
            const theoryPct=(Number(focused13Blocks.theoreticalRate13 || 0)*100).toFixed(4)+'%';
            if (focusedBlocksNoteEl) focusedBlocksNoteEl.innerHTML = '<strong>Consistência entre períodos:</strong> Focado 13 ficou acima do aleatório na média em <strong>' + Number(focused13Blocks.avgWins||0) + '/3</strong> blocos e na taxa 13+ em <strong>' + Number(focused13Blocks.rate13Wins||0) + '/3</strong>. Ficou acima da referência matemática de 13+ (' + theoryPct + ') em <strong>' + Number(focused13Blocks.theoryWins||0) + '/3</strong>. Os blocos usam <strong>alvos não sobrepostos</strong>; as bases de treino podem compartilhar concursos antigos, como é natural no walk-forward.';
        } else if (focusedBlocksEl) {
            focusedBlocksEl.innerHTML = '<div class="p-6 text-center text-[9px] font-bold text-gray-400 bg-gray-50 rounded-2xl border border-dashed border-gray-200">A validação em 3 blocos é calculada automaticamente quando o teste Focado 13 usa 1.000 ou mais concursos.</div>';
            if (focusedBlocksNoteEl) focusedBlocksNoteEl.textContent = 'Use Focado 13 com período de 1.000 concursos para comparar três blocos de alvos não sobrepostos.';
        }
    }

    // --- RAIO-X DO SMART: ABLAÇÃO PAREADA ---
    const impactEl = document.getElementById('sniper-component-impact-container');
    const impactNoteEl = document.getElementById('sniper-component-impact-note');
    if (impactEl && componentImpact && Object.keys(componentImpact).length) {
        const pp = v => ((v >= 0 ? '+' : '') + (v * 100).toFixed(2) + ' pp');
        const delta = v => ((v >= 0 ? '+' : '') + Number(v || 0).toFixed(3));
        const orderedKeys = ['frequency','delay','markov','cooccurrence','adherence','antiCrowd'];
        let impactHtml = '';
        orderedKeys.forEach(key => {
            const x = componentImpact[key];
            if (!x) return;
            let badge = 'INCONCLUSIVO', badgeClass = 'bg-gray-100 text-gray-500 border-gray-200', borderClass = 'border-gray-200';
            if (x.verdict === 'ajudou') { badge = 'AJUDOU NA AMOSTRA'; badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200'; borderClass = 'border-emerald-200'; }
            else if (x.verdict === 'atrapalhou') { badge = 'ATRAPALHOU NA AMOSTRA'; badgeClass = 'bg-rose-50 text-rose-700 border-rose-200'; borderClass = 'border-rose-200'; }

            impactHtml += '<div class="rounded-2xl border ' + borderClass + ' p-3 bg-white">'
                + '<div class="flex items-start justify-between gap-2 mb-3">'
                + '<div><p class="text-[9px] font-black text-gray-800 uppercase">' + sanitizeHTML(x.label) + '</p>'
                + '<p class="text-[7px] font-bold text-gray-400 uppercase mt-0.5">Smart completo − sem sinal</p></div>'
                + '<span class="text-[6.5px] font-black uppercase border px-1.5 py-0.5 rounded ' + badgeClass + '">' + badge + '</span></div>'
                + '<div class="grid grid-cols-2 gap-2">'
                + '<div class="bg-gray-50 rounded-xl p-2"><p class="text-[7px] font-black text-gray-400 uppercase">Δ Média</p><p class="text-sm font-black text-gray-800">' + delta(x.deltaAvg) + '</p></div>'
                + '<div class="bg-gray-50 rounded-xl p-2"><p class="text-[7px] font-black text-gray-400 uppercase">IC95% aprox.</p><p class="text-[10px] font-black text-gray-700">' + Number(x.ciLow || 0).toFixed(3) + ' a ' + Number(x.ciHigh || 0).toFixed(3) + '</p></div>'
                + '</div>'
                + '<div class="grid grid-cols-2 gap-2 mt-2 text-center">'
                + '<div><p class="text-[7px] font-bold text-gray-400 uppercase">Δ 12+</p><p class="text-[10px] font-black text-yellow-600">' + pp(Number(x.deltaRate12 || 0)) + '</p></div>'
                + '<div><p class="text-[7px] font-bold text-gray-400 uppercase">Δ 13+</p><p class="text-[10px] font-black text-emerald-600">' + pp(Number(x.deltaRate13 || 0)) + '</p></div>'
                + '</div></div>';
        });
        impactEl.innerHTML = impactHtml;

        const decisive = Object.values(componentImpact).filter(x => x.verdict !== 'inconclusivo');
        const positive = decisive.filter(x => x.verdict === 'ajudou').map(x => x.label);
        const negative = decisive.filter(x => x.verdict === 'atrapalhou').map(x => x.label);
        let note = '<strong>Como ler:</strong> Δ média positivo significa que retirar o componente piorou o Smart; negativo significa que retirar melhorou. ';
        if (!decisive.length) note += 'Nesta amostra, nenhum componente teve diferença média com IC95% aproximado totalmente fora de zero.';
        else {
            if (positive.length) note += '<strong>Sinais positivos:</strong> ' + positive.map(sanitizeHTML).join(', ') + '. ';
            if (negative.length) note += '<strong>Sinais negativos:</strong> ' + negative.map(sanitizeHTML).join(', ') + '. ';
            note += 'Isso é evidência dentro deste recorte, não garantia futura.';
        }
        if (impactNoteEl) impactNoteEl.innerHTML = note;
    } else if (impactEl) {
        impactEl.innerHTML = '<div class="col-span-full p-6 text-center text-[9px] font-bold text-gray-400 bg-gray-50 rounded-2xl">Sem dados de ablação nesta execução.</div>';
    }

    // --- AUTO-CALIBRAÇÃO NESTED WALK-FORWARD ---
    const calibrationEl = document.getElementById('sniper-calibration-container');
    const calibrationNoteEl = document.getElementById('sniper-calibration-note');
    if (calibrationEl && calibrationSummary) {
        const orderedKeys = ['frequency','delay','markov','cooccurrence','adherence','antiCrowd'];
        const weights = calibrationSummary.latestWeights || SMART_WEIGHTS_CORE;
        const avgWeights = calibrationSummary.averageWeights || weights;
        let html = '<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">';
        orderedKeys.forEach(key => {
            const meta = SMART_COMPONENTS_CORE[key];
            const w = Number(weights[key] || 0);
            const avg = Number(avgWeights[key] || 0);
            const base = Number(SMART_WEIGHTS_CORE[key] || 0);
            const diff = w - base;
            const diffText = (diff >= 0 ? '+' : '') + (diff * 100).toFixed(1) + ' pp';
            html += '<div class="bg-white border border-cyan-100 rounded-2xl p-3">'
                + '<p class="text-[8px] font-black text-gray-500 uppercase h-7">' + sanitizeHTML(meta?.short || key) + '</p>'
                + '<p class="text-xl font-black text-cyan-700">' + (w * 100).toFixed(1) + '%</p>'
                + '<p class="text-[7px] font-bold text-gray-400 mt-1">vs fixo ' + diffText + '</p>'
                + '<p class="text-[7px] font-bold text-gray-300">média WF ' + (avg * 100).toFixed(1) + '%</p>'
                + '</div>';
        });
        html += '</div>';
        const af = calibrationSummary.autoVsFixed || {mean:0,low:0,high:0,n:0};
        const verdict = af.low > 0 ? 'Smart Auto superou o Fixo nesta amostra' : af.high < 0 ? 'Smart Auto ficou abaixo do Fixo nesta amostra' : 'Diferença Auto × Fixo inconclusiva';
        html += '<div class="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3">'
            + '<div class="bg-cyan-50 border border-cyan-100 rounded-xl p-2 text-center"><p class="text-[7px] font-black text-cyan-500 uppercase">Janela interna</p><p class="text-sm font-black text-cyan-800">' + Number(calibrationSummary.window || 0) + ' concursos</p></div>'
            + '<div class="bg-cyan-50 border border-cyan-100 rounded-xl p-2 text-center"><p class="text-[7px] font-black text-cyan-500 uppercase">Pesos alterados</p><p class="text-sm font-black text-cyan-800">' + Number(calibrationSummary.changedCount || 0) + '/' + Number(calibrationSummary.totalCalibrations || 0) + '</p></div>'
            + '<div class="bg-cyan-50 border border-cyan-100 rounded-xl p-2 text-center"><p class="text-[7px] font-black text-cyan-500 uppercase">Δ interno médio</p><p class="text-sm font-black text-cyan-800">' + ((Number(calibrationSummary.avgInnerDelta || 0) >= 0 ? '+' : '') + Number(calibrationSummary.avgInnerDelta || 0).toFixed(3)) + '</p></div>'
            + '<div class="bg-cyan-50 border border-cyan-100 rounded-xl p-2 text-center"><p class="text-[7px] font-black text-cyan-500 uppercase">Auto − Fixo externo</p><p class="text-sm font-black text-cyan-800">' + ((Number(af.mean || 0) >= 0 ? '+' : '') + Number(af.mean || 0).toFixed(3)) + '</p></div>'
            + '</div>';
        calibrationEl.innerHTML = html;
        if (calibrationNoteEl) calibrationNoteEl.innerHTML = '<strong>' + sanitizeHTML(verdict) + '.</strong> IC95% aproximado da diferença pareada: ' + Number(af.low || 0).toFixed(3) + ' a ' + Number(af.high || 0).toFixed(3) + ' (n=' + Number(af.n || 0) + '). Os pesos de cada alvo foram escolhidos somente com concursos anteriores ao próprio alvo.';
    } else if (calibrationEl) {
        calibrationEl.innerHTML = '<div class="p-6 text-center text-[9px] font-bold text-gray-400 bg-gray-50 rounded-2xl">Sem dados de auto-calibração nesta execução.</div>';
    }

    // --- RESUMO PRINCIPAL ---
    const avgHit  = validPeriods > 0 ? (sumBestHits / validPeriods).toFixed(2) : '0.00';
    const hits11p = (totalHits[11]||0)+(totalHits[12]||0)+(totalHits[13]||0)+(totalHits[14]||0)+(totalHits[15]||0);
    const hits12p = (totalHits[12]||0)+(totalHits[13]||0)+(totalHits[14]||0)+(totalHits[15]||0);
    const hits13p = (totalHits[13]||0)+(totalHits[14]||0)+(totalHits[15]||0);

    document.getElementById('sniper-avg-hits').textContent = avgHit;
    document.getElementById('sniper-best-hit').textContent = bestHitGlobal + ' pts';
    document.getElementById('sniper-hits-11plus').textContent = hits11p;
    document.getElementById('sniper-hits-12plus').textContent = hits12p;
    document.getElementById('sniper-hits-13plus').textContent = hits13p;
    document.getElementById('sniper-setup-info').textContent = period + ' conc | ' + setupBadgeName + ' | ' + gamesCount + '/conc | ' + allGamesTotal + ' apostas';
    document.getElementById('sniper-history-body').innerHTML = historyHtml;

    const statusBadge = document.getElementById('sniper-status-badge');
    if (statusBadge) {
        statusBadge.textContent = 'Teste Concluído';
        statusBadge.className = 'text-[8px] font-black bg-emerald-100 text-emerald-600 px-2 py-1 rounded uppercase border border-emerald-200';
    }

    // --- DIAGNÓSTICO SEM PROMESSA PREDITIVA ---
    let robText = 'Backtest walk-forward reprodutível com <strong>' + allGamesTotal + '</strong> apostas em <strong>' + period + '</strong> concursos. Cada alvo foi testado usando somente concursos anteriores.';
    if (executionProfile === 'focado13_deep') robText += ' <strong>Perfil Focado 13 profundo:</strong> para ganhar escala, esta execução calculou Aleatório + Focado 12 + Focado 13 e o Raio-X de afinidades; Smart e Conexões não foram recalculados.';
    if (focused13Blocks) robText += ' A validação complementar percorreu <strong>' + Number(focused13Blocks.totalTargets || 0) + '</strong> alvos em três blocos temporais não sobrepostos.';
    if (Number.isFinite(Number(elapsedMs))) robText += ' Tempo do motor: <strong>' + (Number(elapsedMs)/1000).toFixed(1) + ' s</strong>.';
    robText += '<br><br>';
    if (period <= 15) robText += '<strong>Amostra curta:</strong> a variância domina; não tire conclusão de vantagem com poucos concursos.<br>';
    else if (period < 50) robText += '<strong>Amostra intermediária:</strong> use o resultado como triagem, não como prova de vantagem.<br>';
    else robText += '<strong>Amostra mais útil:</strong> ainda assim, desempenho histórico não garante desempenho futuro.<br>';

    if (baseline) {
        const lift = baseline.lift13;
        const liftText = lift === null || !Number.isFinite(lift) ? 'indefinido (controle sem 13+ nesta amostra)' : ((lift >= 0 ? '+' : '') + lift.toFixed(1) + '%');
        const selCI = baseline.selectedCI13 || {low:0,high:0};
        const rndCI = baseline.randomCI13 || {low:0,high:0};
        let evidence = 'Os intervalos de 95% se sobrepõem: <strong>não há evidência clara de vantagem</strong> sobre o aleatório nesta amostra.';
        if (selCI.low > rndCI.high) evidence = 'A taxa 13+ ficou acima do controle com intervalos sem sobreposição nesta amostra. Isso é um sinal para repetir em janelas maiores, não uma garantia.';
        else if (selCI.high < rndCI.low) evidence = 'A estratégia ficou abaixo do controle aleatório nesta amostra.';

        robText += '<br><strong>' + sanitizeHTML(setupBadgeName) + ' 13+:</strong> ' + fmtPct(baseline.selectedRate13)
            + ' (IC95% ' + fmtPct(selCI.low) + '–' + fmtPct(selCI.high) + ').<br>'
            + '<strong>Aleatório 13+:</strong> ' + fmtPct(baseline.randomRate13)
            + ' (IC95% ' + fmtPct(rndCI.low) + '–' + fmtPct(rndCI.high) + ').<br>'
            + '<strong>Lift observado:</strong> ' + liftText + '. ' + evidence + '<br>'
            + '<strong>Referência matemática por aposta:</strong> aleatório 13+ ≈ ' + fmtPct(baseline.theoretical?.p13plus || 0, 4) + '.';
    }

    const bestName = compStats[bestCompStrategy]?.name || 'Indefinida';
    robText += '<br><br><strong>Melhor na amostra:</strong> ' + sanitizeHTML(bestName) + '. O rótulo significa apenas melhor desempenho neste recorte, não superioridade futura.';
    document.getElementById('sniper-robustness-text').innerHTML = robText;

    // Persiste resultado do backtest no IndexedDB
    salvar('backtestResults', {
        dataExecucao: Date.now(),
        configuracao: { periodo: period, estrategia: actualStrategy, gamesCount, apostas: allGamesTotal },
        resumo: {
            media13Plus: allGamesTotal > 0 ? parseFloat((hits13p / allGamesTotal).toFixed(6)) : 0,
            mediaAcertos: validPeriods > 0 ? parseFloat((sumBestHits / validPeriods).toFixed(2)) : 0,
            melhorResultado: bestHitGlobal,
            baseline: baseline || null,
            componentImpact: componentImpact || null,
            ablationStats: ablationStats || null,
            calibrationSummary: calibrationSummary || null,
            focused13Audit: focused13Audit || null,
            focused13Blocks: focused13Blocks || null,
            executionProfile: executionProfile || null,
            elapsedMs: Number(elapsedMs || 0)
        },
        pesosUsados: { ...scoreWeights }
    }).then(() => renderHistoricoBacktests()).catch(() => {});
}


function _renderAffinity13Lab(result) {
    const verdictEl = document.getElementById('affinity13-verdict');
    const summaryEl = document.getElementById('affinity13-summary');
    const compareEl = document.getElementById('affinity13-comparison');
    const blocksEl = document.getElementById('affinity13-blocks');
    const noteEl = document.getElementById('affinity13-note');
    if (!verdictEl || !summaryEl || !compareEl || !blocksEl) return;

    const pct = (v, d=3) => Number.isFinite(Number(v)) ? (Number(v)*100).toFixed(d) + '%' : '--';
    const delta = v => (Number(v)>=0?'+':'') + Number(v||0).toFixed(3);
    const pp = v => (Number(v)>=0?'+':'') + (Number(v||0)*100).toFixed(3) + ' pp';
    const ciText = ci => ci ? delta(ci.mean) + ' [IC95% ' + Number(ci.low||0).toFixed(3) + ' a ' + Number(ci.high||0).toFixed(3) + ']' : '--';
    const agg = result.aggregate || {};

    const verdictMeta = result.verdict === 'zero13'
        ? {title:'MÉDIA FAVORECE ZERO13 NESTE TESTE', cls:'bg-emerald-50 border-emerald-200 text-emerald-800'}
        : result.verdict === 'high13'
            ? {title:'MÉDIA FAVORECE HIGH13 NESTE TESTE', cls:'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-800'}
            : {title:'DIFERENÇA NÃO DEMONSTRADA', cls:'bg-slate-50 border-slate-200 text-slate-700'};
    verdictEl.className = 'mb-4 p-4 border rounded-2xl ' + verdictMeta.cls;
    verdictEl.innerHTML = '<div class="flex flex-col md:flex-row md:items-center justify-between gap-2">'
        + '<div><p class="text-[10px] font-black uppercase tracking-wider">' + verdictMeta.title + '</p>'
        + '<p class="text-[9px] font-medium mt-1">' + sanitizeHTML(result.reason || '') + ' Média de acertos não comprova vantagem em 13+, 14+ ou 15. Seeds sobre os mesmos alvos não são novos sorteios independentes.' + '</p></div>'
        + '<div class="text-[8px] font-black uppercase opacity-70">' + Number(result.seeds||0) + ' seeds · ' + Number(result.totalTargets||0) + ' alvos · ' + Number(result.pool?.built||0).toLocaleString('pt-BR') + ' jogos-base</div></div>';

    const cards = [
        ['random','Aleatório puro','slate'], ['zero','ZERO13','emerald'], ['neutral','NEUTRO13','indigo'], ['high','HIGH13 · top 5%','fuchsia']
    ];
    summaryEl.innerHTML = cards.map(([key,label,tone]) => {
        const st=agg[key]||{};
        const border = tone==='emerald'?'border-emerald-200':tone==='fuchsia'?'border-fuchsia-200':tone==='indigo'?'border-indigo-200':'border-slate-200';
        return '<div class="p-3 rounded-2xl border '+border+' bg-white">'
            + '<p class="text-[9px] font-black uppercase text-gray-700">'+label+'</p>'
            + '<div class="grid grid-cols-2 gap-2 mt-3">'
            + '<div><p class="text-[7px] font-black text-gray-400 uppercase">Melhor/Alvo</p><p class="text-xl font-black text-gray-800">'+Number(st.avgBest||0).toFixed(3)+'</p></div>'
            + '<div><p class="text-[7px] font-black text-gray-400 uppercase">13+</p><p class="text-xl font-black text-emerald-600">'+Number(st.hits13||0)+'</p><p class="text-[7px] font-bold text-gray-400">'+pct(st.rate13,4)+'</p></div>'
            + '</div><div class="grid grid-cols-3 gap-1 mt-3 pt-2 border-t border-gray-100 text-center">'
            + '<div><p class="text-[6px] font-bold text-gray-400">11+</p><p class="text-[9px] font-black text-indigo-600">'+Number(st.hits11||0)+'</p></div>'
            + '<div><p class="text-[6px] font-bold text-gray-400">12+</p><p class="text-[9px] font-black text-yellow-600">'+Number(st.hits12||0)+'</p></div>'
            + '<div><p class="text-[6px] font-bold text-gray-400">14+</p><p class="text-[9px] font-black text-rose-600">'+Number(st.hits14||0)+'</p></div></div>'
            + (key==='random'?'':'<p class="text-[7px] font-bold text-gray-400 mt-2">Afinidade 13 média: <strong class="text-gray-700">'+Number(st.avgAffinity||0).toFixed(2)+'</strong></p>')
            + '</div>';
    }).join('');

    const g=result.global||{}, zv=g.zeroVsNeutral||{}, hv=g.highVsNeutral||{};
    const comparisonCard=(title,obj,blockWins,tone)=>'<div class="p-4 rounded-2xl border '+(tone==='emerald'?'border-emerald-200 bg-emerald-50/30':'border-fuchsia-200 bg-fuchsia-50/30')+'">'
        + '<p class="text-[9px] font-black uppercase text-gray-700">'+title+'</p>'
        + '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">'
        + '<div class="bg-white rounded-xl p-2"><p class="text-[7px] font-bold text-gray-400 uppercase">Δ melhor/alvo</p><p class="text-sm font-black text-gray-800">'+delta(obj.avgCI?.mean)+'</p><p class="text-[7px] text-gray-400">'+Number(obj.avgCI?.low||0).toFixed(3)+' a '+Number(obj.avgCI?.high||0).toFixed(3)+'</p></div>'
        + '<div class="bg-white rounded-xl p-2"><p class="text-[7px] font-bold text-gray-400 uppercase">Seeds vencedoras</p><p class="text-sm font-black text-gray-800">'+Number(obj.avgSeedWins||0)+'/'+Number(result.seeds||0)+'</p></div>'
        + '<div class="bg-white rounded-xl p-2"><p class="text-[7px] font-bold text-gray-400 uppercase">Blocos vencedores</p><p class="text-sm font-black text-gray-800">'+Number(blockWins||0)+'/3</p></div>'
        + '<div class="bg-white rounded-xl p-2"><p class="text-[7px] font-bold text-gray-400 uppercase">Δ taxa 13+</p><p class="text-sm font-black text-gray-800">'+pp(obj.rate13CI?.mean)+'</p><p class="text-[7px] text-gray-400">seeds 13+: '+Number(obj.rate13SeedWins||0)+'/'+Number(result.seeds||0)+'</p></div>'
        + '</div><p class="text-[7px] text-gray-400 mt-2">IC do Δ médio calculado entre seeds: '+ciText(obj.avgCI)+'</p></div>';
    compareEl.innerHTML = comparisonCard('ZERO13 − NEUTRO13',zv,g.zeroBlocks,'emerald') + comparisonCard('HIGH13 − NEUTRO13',hv,g.highBlocks,'fuchsia');

    blocksEl.innerHTML = (result.blocks||[]).map(b=>{
        const a=b.aggregate||{}, z=b.zeroVsNeutral||{}, h=b.highVsNeutral||{}, av=b.availability||{}, dist=b.structuralDistance||{};
        return '<div class="p-3 rounded-2xl border border-gray-200 bg-white">'
            + '<div class="flex justify-between gap-2"><div><p class="text-[9px] font-black uppercase text-gray-700">Bloco '+sanitizeHTML(b.label||'')+'</p><p class="text-[7px] text-gray-400 font-bold">#'+sanitizeHTML(String(b.startContest||'--'))+' → #'+sanitizeHTML(String(b.endContest||'--'))+' · '+Number(b.targets||0)+' alvos</p></div><span class="text-[7px] font-black text-gray-400">ZERO disponível '+pct(av.zeroAvailability,1)+'</span></div>'
            + '<div class="grid grid-cols-3 gap-1 mt-3 text-center">'
            + '<div class="bg-emerald-50 rounded-xl p-2"><p class="text-[7px] font-black text-emerald-700">ZERO</p><p class="text-sm font-black text-gray-800">'+Number(a.zero?.avgBest||0).toFixed(3)+'</p><p class="text-[7px] text-gray-400">13+ '+pct(a.zero?.rate13,4)+'</p></div>'
            + '<div class="bg-indigo-50 rounded-xl p-2"><p class="text-[7px] font-black text-indigo-700">NEUTRO</p><p class="text-sm font-black text-gray-800">'+Number(a.neutral?.avgBest||0).toFixed(3)+'</p><p class="text-[7px] text-gray-400">13+ '+pct(a.neutral?.rate13,4)+'</p></div>'
            + '<div class="bg-fuchsia-50 rounded-xl p-2"><p class="text-[7px] font-black text-fuchsia-700">HIGH</p><p class="text-sm font-black text-gray-800">'+Number(a.high?.avgBest||0).toFixed(3)+'</p><p class="text-[7px] text-gray-400">13+ '+pct(a.high?.rate13,4)+'</p></div></div>'
            + '<div class="grid grid-cols-2 gap-2 mt-2"><div class="bg-gray-50 rounded-xl p-2"><p class="text-[7px] text-gray-400 font-bold">ZERO − N</p><p class="text-[10px] font-black">'+delta(z.avgCI?.mean)+' · '+Number(z.avgWins||0)+'/'+Number(result.seeds||0)+' seeds</p></div><div class="bg-gray-50 rounded-xl p-2"><p class="text-[7px] text-gray-400 font-bold">HIGH − N</p><p class="text-[10px] font-black">'+delta(h.avgCI?.mean)+' · '+Number(h.avgWins||0)+'/'+Number(result.seeds||0)+' seeds</p></div></div>'
            + '<p class="text-[7px] text-gray-400 mt-2">Afinidade HIGH ≥ ~'+Number(av.avgHighThreshold||0).toFixed(1)+'; máximo médio '+Number(av.avgMaxAffinity||0).toFixed(1)+' · distância estrutural Z↔N '+Number(dist.zeroNeutral||0).toFixed(2)+' / Z↔H '+Number(dist.zeroHigh||0).toFixed(2)+'</p>'
            + '</div>';
    }).join('');

    const recent=(result.blocks||[])[0]?.availability||{};
    noteEl.innerHTML = '<strong>Como ler:</strong> o controle decisivo é NEUTRO13, não o aleatório puro. ZERO, NEUTRO e HIGH vêm do mesmo universo de jogos equilibrados e todos evitam histórico de 14/15. '
        + 'O HIGH representa o <strong>top 5%</strong> de afinidade 13; o NEUTRO fica na faixa mediana; ZERO tem afinidade exatamente 0. '
        + 'As seeds mudam apenas a escolha dentro das faixas, enquanto os três blocos usam alvos temporais não sobrepostos. '
        + 'No bloco recente havia em média <strong>'+Number(recent.avgZeroPool||0).toFixed(1)+'</strong> jogos ZERO disponíveis entre '+Number(recent.avgAllowedPool||0).toFixed(0)+' candidatos válidos. '
        + 'Tempo: <strong>'+((Number(result.elapsedMs||0))/1000).toFixed(1)+' s</strong>. Contagens agregadas entre seeds são descritivas; a decisão usa consistência entre seeds e blocos para evitar falsa precisão.';
}

function runAffinity13Lab() {
    if (database.length < 350) {
        showToast('Base insuficiente para o Duelo de Afinidade 13.', 'warning');
        return;
    }
    const seeds=parseInt(document.getElementById('affinity13-seeds')?.value||'8');
    const gamesCount=parseInt(document.getElementById('affinity13-games')?.value||'3');
    const poolSize=parseInt(document.getElementById('affinity13-pool')?.value||'10000');
    const btn=document.getElementById('btn-run-affinity13');
    const wrap=document.getElementById('affinity13-progress-wrap');
    const bar=document.getElementById('affinity13-progress-bar');
    const label=document.getElementById('affinity13-progress-label');
    const pctEl=document.getElementById('affinity13-progress-pct');
    if(activeAffinity13Worker){try{activeAffinity13Worker.terminate();}catch(e){} activeAffinity13Worker=null;}
    if(btn){btn.disabled=true;btn.textContent='Executando...';}
    if(wrap)wrap.classList.remove('hidden');
    if(bar)bar.style.width='0%'; if(pctEl)pctEl.textContent='0%'; if(label)label.textContent='Montando universo equilibrado...';

    const worker=new Worker(new URL('./workers/affinity13.worker.js?v=5.2.0',import.meta.url));
    activeAffinity13Worker=worker;
    worker.postMessage({database,seeds,gamesCount,poolSize});
    worker.onmessage=e=>{
        const msg=e.data||{};
        if(msg.type==='progress'){
            let overall=0,phase='';
            const frac=msg.total?Math.max(0,Math.min(1,msg.current/msg.total)):0;
            if(msg.phase==='pool'){overall=frac*10;phase='Montando universo equilibrado';}
            else if(msg.phase==='index'){overall=10+frac*25;phase='Medindo histórico de 13/14';}
            else {overall=35+frac*65;phase='Walk-forward · ZERO × NEUTRO × HIGH';}
            if(bar)bar.style.width=overall.toFixed(1)+'%'; if(pctEl)pctEl.textContent=Math.round(overall)+'%'; if(label)label.textContent=phase+' ['+msg.current+'/'+msg.total+']';
        } else if(msg.type==='result'){
            worker.terminate();activeAffinity13Worker=null;
            if(btn){btn.disabled=false;btn.textContent='Executar duelo 13';}
            if(bar)bar.style.width='100%';if(pctEl)pctEl.textContent='100%';if(label)label.textContent='Teste concluído';
            if(msg.workerBuild!==AFFINITY13_WORKER_BUILD){showToast('Worker do laboratório desatualizado. Faça Ctrl+F5.', 'error');return;}
            _renderAffinity13Lab(msg);showToast('Duelo de Afinidade 13 concluído.', 'success');
        } else if(msg.type==='error'){
            worker.terminate();activeAffinity13Worker=null;if(btn){btn.disabled=false;btn.textContent='Executar duelo 13';}
            showToast('Erro no laboratório 13: '+(msg.message||'desconhecido'),'error');
        }
    };
    worker.onerror=err=>{worker.terminate();activeAffinity13Worker=null;if(btn){btn.disabled=false;btn.textContent='Executar duelo 13';}showToast('Erro no laboratório 13: '+(err.message||'desconhecido'),'error');};
}

async function runSniperBacktest() {
    if (database.length < 60) {
        showToast('Base insuficiente: o Sniper precisa preservar pelo menos 50 concursos anteriores para treino.', 'warning');
        return;
    }
    const period     = parseInt(document.getElementById('sniper-period').value);
    const strategy   = document.getElementById('sniper-strategy').value;
    const gamesCount = parseInt(document.getElementById('sniper-games-count').value);
    const maxPeriod = Math.max(0, database.length - 50);
    if (period > maxPeriod) showToast(`Para evitar look-ahead, serão testados ${maxPeriod} concursos e 50 ficarão como histórico mínimo.`, 'info');
    if (strategy === 'focado13') showToast(period >= 1000 ? 'Perfil Focado 13 profundo: Raio-X + validação em 3 blocos. Smart/Conexões ficam fora desta execução.' : 'Perfil Focado 13 profundo ativado: Aleatório + Focado 12 + Focado 13 + Raio-X. Smart/Conexões ficam fora desta execução para ganhar escala.', 'info');

    document.getElementById('loading-overlay').style.display = 'flex';
    document.getElementById('loading-text').textContent = 'Iniciando Backtest...';

    // Worker path relativo a js/main.js (import.meta.url disponivel em modulos ES)
    const worker = new Worker(new URL('./workers/backtest.worker.js?v=5.1.0', import.meta.url), { type: 'module' });
    worker.postMessage({ database, period, strategy, gamesCount, conexaoMode, calibrationWindow: 16, calibrationCandidateCount: 150 });

    worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'progress') {
            const phaseLabel = msg.phase === 'calibration' ? 'Calibração Nested'
                : msg.phase === 'focused-index' ? 'Indexando afinidades 13/14'
                : msg.phase === 'focused-blocks' ? 'Validando blocos Focado 13'
                : 'Walk-Forward';
            document.getElementById('loading-text').textContent = phaseLabel + ' [' + msg.current + '/' + msg.total + ']...';
        } else if (msg.type === 'result') {
            worker.terminate();
            document.getElementById('loading-overlay').style.display = 'none';
            if (msg.workerBuild !== SNIPER_WORKER_BUILD) {
                showToast('Worker do Sniper desatualizado. Recarregue a página; a v5.1 bloqueou a mistura de versões.', 'error');
                console.error('[Sniper] Build incompatível:', msg.workerBuild, 'esperado:', SNIPER_WORKER_BUILD);
                return;
            }
            _renderBacktestResults(msg, strategy, gamesCount);
            document.getElementById('loading-text').textContent = 'Calibrando Estratégia...';
        } else if (msg.type === 'error') {
            worker.terminate();
            document.getElementById('loading-overlay').style.display = 'none';
            showToast('Erro no backtest: ' + (msg.message || 'desconhecido'), 'error');
        }
    };

    worker.onerror = (err) => {
        worker.terminate();
        document.getElementById('loading-overlay').style.display = 'none';
        showToast('Erro no backtest: ' + (err.message || 'desconhecido'), 'error');
    };
}

window.onload = async () => {
    // F3.7 — Restaurar pesos calibrados (localStorage como fallback inicial)
    try { const sw = localStorage.getItem('scoreWeights'); if (sw) scoreWeights = JSON.parse(sw); } catch(e) {}

    // F4.9 — Sobrescreve com pesos do IDB (fonte primaria, mais confiavel)
    try {
        const cfg = await buscarUm('appConfig', 'scoreWeights');
        if (cfg && cfg.valor) scoreWeights = cfg.valor;
    } catch(e) {}

    _renderScoreWeights();
    initBoard();

    // F4.5 — Migrar jogos do localStorage para IndexedDB (executa apenas uma vez)
    await migrarLocalStorageParaIDB().catch(() => {});

    // F4.4 — Carregar jogos salvos do IDB com paginacao (max 50 por vez, mais recentes primeiro)
    try {
        const idbGames = await buscarPaginado('savedGames', 0, 50);
        if (idbGames.length > 0) {
            mySavedGames = idbGames; // ja ordenados do mais recente para o mais antigo
            renderSavedGames();
        }
    } catch(e) {}

    const savedRawData = localStorage.getItem('lotoRawData');
    const savedDatabase = localStorage.getItem('lotoDatabase');
    const savedStandards = localStorage.getItem('lotoStandards');
    // Dados padrão carregados de js/data/defaultData.js (DEFAULT_HISTORY)
    const userHistory = DEFAULT_HISTORY;
    document.getElementById('raw-data').value = savedRawData || userHistory;
    if (savedDatabase && savedStandards) {
        try {
            database = JSON.parse(savedDatabase); historicalStandards = JSON.parse(savedStandards);
            const tc = document.getElementById('total-contests'); if(tc) tc.textContent = database.length;
            await calculateCoincidencesFast(); coOcorrenciaData = calcularMatrizCoOcorrencia(database); clusterData = clusterizarJaccard(coOcorrenciaData.coMatrix, coOcorrenciaData.freqs); markovData = construirMatrizTransicao(database); updateHeatmapAndDelays(); updateAnalysisRange(0); gerarDistribuicoesHistoricas(); 
        } catch(e) { importHistory(); }
    } else { importHistory(); }
    const savedBoard = localStorage.getItem('lotoCurrentBoard');
    if (savedBoard) {
        try {
            const parsedBoard = JSON.parse(savedBoard);
            if (Array.isArray(parsedBoard) && parsedBoard.length > 0) {
                parsedBoard.forEach(n => { selectedNumbers.add(n); const el = document.getElementById(`num-${n}`); if (el) { el.classList.add('selected'); el.setAttribute('aria-pressed', 'true'); } });
                if (savedDatabase && savedStandards) updateAnalysis(); else setTimeout(() => updateAnalysis(), 150);
            }
        } catch(e) { localStorage.removeItem('lotoCurrentBoard'); }
    }

    // F4.8 — Carrega historico de backtests no painel Sniper
    renderHistoricoBacktests().catch(() => {});
};

// initBoard/toggleNumber inline — versão definitiva (com ARIA) em js/ui/board.js (migrar em F1.8)
function initBoard() {
    const b = document.getElementById('board'); if(!b) return; b.innerHTML = '';
    for (let i = 1; i <= 25; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ball bg-white h-12 sm:h-14 flex items-center justify-center rounded-2xl font-black text-lg shadow-sm border-gray-100';
        btn.setAttribute('aria-label', 'Número ' + String(i).padStart(2, '0'));
        btn.setAttribute('aria-pressed', 'false');
        const numSpan = document.createElement('span'); numSpan.className = 'ball-num'; numSpan.textContent = String(i).padStart(2, '0');
        const delaySpan = document.createElement('span'); delaySpan.id = 'delay-' + i; delaySpan.className = 'delay-badge'; delaySpan.style.display = 'none'; delaySpan.textContent = '0'; delaySpan.setAttribute('aria-hidden', 'true');
        const trendSpan = document.createElement('span'); trendSpan.id = 'trend-' + i; trendSpan.className = 'trend-badge'; trendSpan.setAttribute('aria-hidden', 'true');
        btn.appendChild(numSpan); btn.appendChild(delaySpan); btn.appendChild(trendSpan);
        btn.onclick = () => toggleNumber(i, btn); btn.id = 'num-' + i; b.appendChild(btn);
    }
}

function toggleNumber(num, el) {
    if (selectedNumbers.has(num)) {
        selectedNumbers.delete(num); el.classList.remove('selected'); el.setAttribute('aria-pressed', 'false');
    } else if (selectedNumbers.size < RULES.max_pick) {
        selectedNumbers.add(num); el.classList.add('selected'); el.setAttribute('aria-pressed', 'true');
    } else { return; }
    updateAnalysis();
}

// ─── F3.7 — Calibração de Pesos (Grid Search walk-forward) ──────────────────

function _renderScoreWeights() {
    const el = document.getElementById('score-weights-display');
    if (!el) return;
    const hPct = Math.round(scoreWeights.h * 100);
    const pPct = Math.round(scoreWeights.p * 100);
    const cPct = Math.round(scoreWeights.c * 100);
    el.innerHTML =
        `<span class="font-black text-emerald-600">${hPct}%</span> Hist&oacute;rico &nbsp;&middot;&nbsp;` +
        `<span class="font-black text-indigo-600">${pPct}%</span> Raridade &nbsp;&middot;&nbsp;` +
        `<span class="font-black text-orange-500">${cPct}%</span> Cobertura`;
}

function calibrarPesos() {
    if (database.length < 40) {
        showToast('Base insuficiente para calibrar (m\u00ednimo 40 concursos)', 'error');
        return;
    }
    const btn = document.getElementById('btn-calibrar-pesos');
    if (btn) { btn.disabled = true; btn.textContent = 'Calibrando\u2026'; }

    setTimeout(() => {
        const VALIDATION = Math.min(30, Math.floor(database.length * 0.3));
        const CANDIDATES = 30; // candidatos por rodada de valida\u00e7\u00e3o

        // Pr\u00e9-computar sub-scores (independentes dos pesos) para cada rodada
        const valContests = database.slice(0, VALIDATION);
        const pools = valContests.map(contest => {
            const pool = [];
            for (let t = 0; t < CANDIDATES; t++) {
                const src = Array.from({ length: 25 }, (_, i) => i + 1);
                const cand = [];
                while (cand.length < 15) cand.push(src.splice((Math.random() * src.length) | 0, 1)[0]);
                cand.sort((a, b) => a - b);
                const sc = evaluateCandidate(cand);
                const hits = cand.filter(n => contest.nums.includes(n)).length;
                pool.push({ hs: sc.historicalScore, pop: sc.humanPopularity, cov: sc.coverageScore, hits });
            }
            return pool;
        });

        // Enumerar combinações (wH, wP, wC) com step=0.05 e soma=1.0
        const combos = [];
        for (let h = 5; h <= 90; h += 5) {
            for (let p = 5; p <= 90; p += 5) {
                const c = 100 - h - p;
                if (c >= 5 && c <= 90) combos.push([h / 100, p / 100, c / 100]);
            }
        }

        // Para cada combo, simula: escolhe o candidato de maior score e conta acertos reais
        let bestCombo = [0.45, 0.35, 0.20];
        let bestMetric = -Infinity;

        for (const [wH, wP, wC] of combos) {
            let totalHits = 0;
            for (const pool of pools) {
                let bestScore = -Infinity;
                let bestHits = 0;
                for (const c of pool) {
                    const score = (c.hs * wH) + ((100 - c.pop) * wP) + (Math.min(100, c.cov * 2.5) * wC);
                    if (score > bestScore) { bestScore = score; bestHits = c.hits; }
                }
                totalHits += bestHits;
            }
            if (totalHits > bestMetric) { bestMetric = totalHits; bestCombo = [wH, wP, wC]; }
        }

        // Aplica pesos e persiste
        scoreWeights = { h: bestCombo[0], p: bestCombo[1], c: bestCombo[2] };
        try { localStorage.setItem('scoreWeights', JSON.stringify(scoreWeights)); } catch (e) {}
        // F4.9 — Persiste pesos calibrados no IDB (appConfig)
        salvar('appConfig', { chave: 'scoreWeights', valor: scoreWeights }).catch(() => {});

        _renderScoreWeights();
        updateAnalysis();
        const hPct = Math.round(scoreWeights.h * 100);
        const pPct = Math.round(scoreWeights.p * 100);
        const cPct = Math.round(scoreWeights.c * 100);
        showToast(`Pesos calibrados: Hist. ${hPct}% \u00b7 Pop. ${pPct}% \u00b7 Cob. ${cPct}%`, 'success', 5000);
        if (btn) { btn.disabled = false; btn.textContent = 'Calibrar Pesos'; }
    }, 50);
}

// F4.8 — Renderiza historico de backtests anteriores carregados do IDB
async function renderHistoricoBacktests() {
    const container = document.getElementById('historico-backtest-container');
    const countEl   = document.getElementById('historico-backtest-count');
    if (!container) return;
    try {
        const registros = await buscarTodos('backtestResults');
        registros.sort((a, b) => b.dataExecucao - a.dataExecucao);
        if (countEl) countEl.textContent = registros.length + ' registro' + (registros.length !== 1 ? 's' : '');
        if (registros.length === 0) {
            container.innerHTML = '<div class="p-8 text-center text-gray-300 text-[11px] font-bold italic">Nenhum backtest salvo ainda. Rode uma simulacao para comecar.</div>';
            return;
        }
        const stratLabels = { smart: 'Smart', focado12: 'Focado 12', focado13: 'Focado 13', conexoes: 'Conexoes' };
        container.innerHTML = registros.map(r => {
            const dt   = new Date(r.dataExecucao).toLocaleString('pt-BR');
            const str  = stratLabels[r.configuracao && r.configuracao.estrategia] || (r.configuracao && r.configuracao.estrategia) || '--';
            const per  = r.configuracao ? r.configuracao.periodo : '--';
            const gc   = r.configuracao ? (r.configuracao.gamesCount || '--') : '--';
            const m13  = r.resumo && r.resumo.media13Plus != null ? (r.resumo.media13Plus * 100).toFixed(1) + '%' : '--';
            const avg  = r.resumo ? r.resumo.mediaAcertos : '--';
            const best = r.resumo ? r.resumo.melhorResultado : '--';
            return '<div class="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">'
                + '<div class="flex flex-col gap-0.5">'
                + '<span class="text-[9px] font-black text-gray-400 uppercase tracking-widest">' + dt + '</span>'
                + '<span class="text-xs font-black text-gray-700">' + str + ' &bull; ' + per + ' conc &bull; ' + gc + 'x/conc</span>'
                + '</div>'
                + '<div class="flex items-center gap-4">'
                + '<div class="text-center"><p class="text-[8px] font-black text-gray-400 uppercase">Avg</p><p class="text-sm font-black text-gray-800">' + avg + '</p></div>'
                + '<div class="text-center"><p class="text-[8px] font-black text-gray-400 uppercase">13+</p><p class="text-sm font-black text-emerald-600">' + m13 + '</p></div>'
                + '<div class="text-center"><p class="text-[8px] font-black text-gray-400 uppercase">Melhor</p><p class="text-sm font-black text-yellow-600">' + best + ' pts</p></div>'
                + '</div></div>';
        }).join('');
    } catch(e) {
        if (container) container.innerHTML = '<div class="p-8 text-center text-gray-400 text-[11px] font-bold italic">Erro ao carregar historico do banco local.</div>';
    }
}

// F4.10 — Exporta conteudo completo do IndexedDB como arquivo JSON portavel
async function exportarIDB() {
    try {
        const [savedGames, contests, backtestResults, appConfig] = await Promise.all([
            buscarTodos('savedGames'),
            buscarTodos('contests'),
            buscarTodos('backtestResults'),
            buscarTodos('appConfig')
        ]);
        const payload = {
            versao       : '4.0',
            timestamp    : new Date().toISOString(),
            savedGames,
            contests,
            backtestResults,
            appConfig
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = 'loto_idb_backup_' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Backup completo do banco local exportado!', 'success');
    } catch(e) {
        showToast('Erro ao exportar o banco local.', 'error');
    }
}

// ─── Expõe funções onclick como globais (type="module" isola o escopo) ────
window.switchTab               = switchTab;
window.clearBoard              = clearBoard;
window.generateSmartGame       = generateSmartGame;
window.generateFocusedGame     = generateFocusedGame;
window.generateStrictFocusedGame = generateStrictFocusedGame;
window.optimizeCurrentGame     = optimizeCurrentGame;
window.saveCurrentGame         = saveCurrentGame;
window.loadSavedGame           = loadSavedGame;
window.removeSavedGame         = removeSavedGame;
window.loadGameToSimulator     = loadGameToSimulator;
window.exportGamesToTxt        = exportGamesToTxt;
window.exportBackup            = exportBackup;
window.exportarIDB             = exportarIDB; // F4.10
window.processImportSavedGames = processImportSavedGames;
window.importHistory           = importHistory;
window.runSniperBacktest       = runSniperBacktest;
window.runAffinity13Lab        = runAffinity13Lab;
window.updateAnalysisRange     = updateAnalysisRange;
window.changeConexaoMode       = changeConexaoMode;
window.generateStructuredConexaoGame = generateStructuredConexaoGame;
window.processImportBackup           = processImportBackup;
window.calibrarPesos                 = calibrarPesos;


// A carteira usa todos os registros persistidos, não apenas a página visível.
createPortfolioPanel(async () => {
    const persisted = await buscarTodos('savedGames');
    const merged = new Map(persisted.map(g => [String(g.id), g]));
    for (const g of mySavedGames) merged.set(String(g.id), g);
    return [...merged.values()];
});
