/**
 * analytics/cooccurrence.js — Matriz de Co-ocorrência + Chi-Quadrado por par
 *
 * Para cada par de dezenas (1-25) calcula:
 *   coMatrix[i][j]  — nº de concursos em que as dezenas (i+1) e (j+1) saíram juntas
 *   chiMatrix[i][j] — chi-quadrado com sinal:
 *                       > 0 → atração (par ocorre mais que o esperado)
 *                       < 0 → repulsão (par ocorre menos que o esperado)
 */

/**
 * Constrói a matriz de co-ocorrência e chi-quadrado para toda a base.
 *
 * @param {Array<{ nums: number[] }>} db
 * @returns {{ coMatrix: Float32Array[], chiMatrix: Float32Array[], freqs: number[], N: number }}
 */
export function calcularMatrizCoOcorrencia(db) {
    const N = db.length;
    if (N === 0) {
        return {
            coMatrix:  Array.from({ length: 25 }, () => new Float32Array(25)),
            chiMatrix: Array.from({ length: 25 }, () => new Float32Array(25)),
            freqs: new Array(25).fill(0),
            N: 0
        };
    }

    const coMatrix  = Array.from({ length: 25 }, () => new Float32Array(25));
    const chiMatrix = Array.from({ length: 25 }, () => new Float32Array(25));
    const freqs     = new Array(25).fill(0);

    // Frequências individuais e co-ocorrências em uma única passagem O(N*C(15,2))
    for (const concurso of db) {
        const nums = concurso.nums;
        for (let a = 0; a < nums.length; a++) {
            const i = nums[a] - 1;
            freqs[i]++;
            for (let b = a + 1; b < nums.length; b++) {
                const j = nums[b] - 1;
                coMatrix[i][j]++;
                coMatrix[j][i]++;
            }
        }
    }

    // Chi-quadrado com sinal para cada par (tabela 2x2)
    for (let i = 0; i < 25; i++) {
        for (let j = i + 1; j < 25; j++) {
            const fi  = freqs[i];
            const fj  = freqs[j];
            const fij = coMatrix[i][j];

            // Tabela 2x2: a=ambos, b=só i, c=só j, d=nenhum
            const a = fij;
            const b = fi - fij;
            const c = fj - fij;
            const d = N - fi - fj + fij;

            const rowA = a + b; // = fi
            const rowB = c + d; // = N - fi
            const colA = a + c; // = fj
            const colB = b + d; // = N - fj

            if (rowA === 0 || rowB === 0 || colA === 0 || colB === 0) continue;

            const adbc   = a * d - b * c;
            const chi    = N * adbc * adbc / (rowA * rowB * colA * colB);
            const signed = adbc >= 0 ? chi : -chi;

            chiMatrix[i][j] = signed;
            chiMatrix[j][i] = signed;
        }
    }

    return { coMatrix, chiMatrix, freqs, N };
}

/**
 * Retorna os topN pares com maior chi-quadrado positivo (maior atração estatística).
 *
 * @param {Float32Array[]} chiMatrix
 * @param {number} [topN=20]
 * @returns {Array<{ i: number, j: number, chi: number }>} dezenas em base 1
 */
export function getTopPares(chiMatrix, topN = 20) {
    const pares = [];
    for (let i = 0; i < 25; i++) {
        for (let j = i + 1; j < 25; j++) {
            if (chiMatrix[i][j] > 0) {
                pares.push({ i: i + 1, j: j + 1, chi: chiMatrix[i][j] });
            }
        }
    }
    pares.sort((a, b) => b.chi - a.chi);
    return pares.slice(0, topN);
}

/**
 * Calcula o Índice de Coesão de um jogo:
 * média do chi-quadrado com sinal de todos os C(15,2)=105 pares do jogo.
 * Valor positivo = pares tendem a sair juntos historicamente.
 * Valor negativo = pares tendem a se evitar.
 *
 * @param {number[]} nums - dezenas do jogo (base 1, 15 elementos)
 * @param {Float32Array[]} chiMatrix
 * @returns {number} média do chi-quadrado dos pares (valor bruto)
 */
export function calcularCoesaoPares(nums, chiMatrix) {
    if (!chiMatrix || nums.length < 2) return 0;
    let soma  = 0;
    let count = 0;
    for (let a = 0; a < nums.length; a++) {
        const i = nums[a] - 1;
        for (let b = a + 1; b < nums.length; b++) {
            soma += chiMatrix[i][nums[b] - 1];
            count++;
        }
    }
    return count === 0 ? 0 : soma / count;
}

// ─── F3.10 — Clustering por distância de Jaccard ─────────────────────────────

/**
 * Constrói a matriz 25×25 de distâncias de Jaccard entre dezenas.
 * dist[i][j] = 1 − coMatrix[i][j] / (freqs[i] + freqs[j] − coMatrix[i][j])
 * 0 = sempre juntas, 1 = nunca juntas.
 *
 * @param {Float32Array[]} coMatrix
 * @param {number[]} freqs
 * @returns {Float32Array[]}
 */
function buildJaccardMatrix(coMatrix, freqs) {
    const D = Array.from({ length: 25 }, () => new Float32Array(25));
    for (let i = 0; i < 25; i++) {
        for (let j = i + 1; j < 25; j++) {
            const intersection = coMatrix[i][j];
            const union        = freqs[i] + freqs[j] - intersection;
            const sim          = union > 0 ? intersection / union : 0;
            D[i][j] = D[j][i] = 1 - sim;
        }
    }
    return D;
}

/**
 * Agrupa as 25 dezenas em k clusters via K-medoids (PAM simplificado)
 * usando a distância de Jaccard como métrica.
 *
 * @param {Float32Array[]} coMatrix
 * @param {number[]} freqs
 * @param {number} [k=5]   - número de clusters (padrão 5 → ~5 dezenas por grupo)
 * @param {number} [restarts=8] - reinícios aleatórios para evitar mínimos locais
 * @returns {{
 *   assignments: number[],    // assignments[i] = índice do cluster (0-based) da dezena i+1
 *   medoids: number[],        // índice (0-based) da dezena medóide de cada cluster
 *   clusters: number[][],     // clusters[c] = índices 0-based das dezenas no cluster c
 *   distMatrix: Float32Array[]
 * }}
 */
export function clusterizarJaccard(coMatrix, freqs, k = 5, restarts = 8) {
    const D = buildJaccardMatrix(coMatrix, freqs);
    const N = 25;

    // Custo total: soma das distâncias de cada ponto ao seu medóide
    const totalCost = (medoids, asgn) => {
        let cost = 0;
        for (let i = 0; i < N; i++) cost += D[i][medoids[asgn[i]]];
        return cost;
    };

    // Atribui cada dezena ao medóide mais próximo
    const assign = medoids => {
        const asgn = new Int8Array(N);
        for (let i = 0; i < N; i++) {
            let bestC = 0, bestD = Infinity;
            for (let c = 0; c < medoids.length; c++) {
                const d = D[i][medoids[c]];
                if (d < bestD) { bestD = d; bestC = c; }
            }
            asgn[i] = bestC;
        }
        return asgn;
    };

    // Atualiza cada medóide para o membro com menor distância intra-cluster
    const updateMedoids = asgn => {
        const newM = new Array(k);
        for (let c = 0; c < k; c++) {
            const members = [];
            for (let i = 0; i < N; i++) if (asgn[i] === c) members.push(i);
            if (members.length === 0) { newM[c] = Math.floor(Math.random() * N); continue; }
            let bestM = members[0], bestCost = Infinity;
            for (const m of members) {
                let cost = 0;
                for (const x of members) cost += D[m][x];
                if (cost < bestCost) { bestCost = cost; bestM = m; }
            }
            newM[c] = bestM;
        }
        return newM;
    };

    // Medóides iniciais determinísticos: mais central + k-1 mais distantes (K-means++ like)
    const initMedoids = () => {
        const m = [];
        let bestM = 0, bestTot = Infinity;
        for (let i = 0; i < N; i++) {
            let tot = 0;
            for (let j = 0; j < N; j++) tot += D[i][j];
            if (tot < bestTot) { bestTot = tot; bestM = i; }
        }
        m.push(bestM);
        while (m.length < k) {
            let farthest = -1, farthestDist = -1;
            for (let i = 0; i < N; i++) {
                if (m.includes(i)) continue;
                const minD = Math.min(...m.map(mj => D[i][mj]));
                if (minD > farthestDist) { farthestDist = minD; farthest = i; }
            }
            m.push(farthest);
        }
        return m;
    };

    let globalBest = null, globalBestCost = Infinity;

    for (let r = 0; r < restarts; r++) {
        let medoids;
        if (r === 0) {
            medoids = initMedoids();
        } else {
            const pool = Array.from({ length: N }, (_, i) => i);
            for (let i = pool.length - 1; i > 0; i--) {
                const j = (Math.random() * (i + 1)) | 0;
                [pool[i], pool[j]] = [pool[j], pool[i]];
            }
            medoids = pool.slice(0, k);
        }

        let asgn = assign(medoids);
        let cost = totalCost(medoids, asgn);

        for (let iter = 0; iter < 50; iter++) {
            const newM    = updateMedoids(asgn);
            const newAsgn = assign(newM);
            const newCost = totalCost(newM, newAsgn);
            if (newCost >= cost) break;
            medoids = newM; asgn = newAsgn; cost = newCost;
        }

        if (cost < globalBestCost) {
            globalBestCost = cost;
            globalBest = { medoids: [...medoids], assignments: Array.from(asgn) };
        }
    }

    const clusters = Array.from({ length: k }, () => []);
    for (let i = 0; i < N; i++) clusters[globalBest.assignments[i]].push(i);

    return {
        assignments: globalBest.assignments,
        medoids:     globalBest.medoids,
        clusters,
        distMatrix:  D
    };
}

/**
 * Calcula o Índice de Diversidade de Cluster de um jogo.
 * Mede o quão bem as 15 dezenas estão distribuídas entre os k clusters —
 * quanto mais uniforme a distribuição, mais diverso o jogo.
 *
 * Usa entropia de Shannon normalizada: 0 = concentrado em 1 cluster, 100 = perfeitamente uniforme.
 *
 * @param {number[]} nums        - dezenas do jogo (base 1)
 * @param {number[]} assignments - de clusterizarJaccard(): assignments[i] = cluster da dezena (i+1)
 * @param {number}   k           - número de clusters
 * @returns {{ clustersPresentes: number, indice: number }} indice ∈ [0, 100]
 */
export function calcularDiversidadeCluster(nums, assignments, k) {
    const counts = new Array(k).fill(0);
    for (const n of nums) counts[assignments[n - 1]]++;
    const clustersPresentes = counts.filter(c => c > 0).length;

    // Entropia de Shannon normalizada
    let H = 0;
    const total = nums.length;
    for (const c of counts) {
        if (c > 0) {
            const p = c / total;
            H -= p * Math.log2(p);
        }
    }
    const Hmax  = Math.log2(k);
    const indice = Hmax > 0 ? Math.round((H / Hmax) * 100) : 0;

    return { clustersPresentes, indice };
}