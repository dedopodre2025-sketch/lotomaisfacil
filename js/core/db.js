// js/core/db.js — F4.1 (IndexedDB — 4 object stores) + F4.2 (helpers CRUD genéricos)

const DB_NAME    = 'LotoMaisFacilDB';
const DB_VERSION = 1;

// F4.1 — Abre (e cria/atualiza) o banco IndexedDB
function abrirBanco() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (event) => {
            const db = event.target.result;

            // savedGames — jogos salvos pelo usuario
            if (!db.objectStoreNames.contains('savedGames')) {
                const s = db.createObjectStore('savedGames', { keyPath: 'id' });
                s.createIndex('idx_dataCriacao', 'dataCriacao', { unique: false });
            }

            // contests — historico de concursos importados
            if (!db.objectStoreNames.contains('contests')) {
                const s = db.createObjectStore('contests', { keyPath: 'id' });
                s.createIndex('idx_dataImportacao', 'dataImportacao', { unique: false });
            }

            // backtestResults — historico de simulacoes Sniper
            if (!db.objectStoreNames.contains('backtestResults')) {
                const s = db.createObjectStore('backtestResults', { keyPath: 'id', autoIncrement: true });
                s.createIndex('idx_dataExecucao', 'dataExecucao', { unique: false });
                s.createIndex('idx_media13Plus',  'resumo.media13Plus', { unique: false });
            }

            // appConfig — configuracoes e pesos calibraveis
            if (!db.objectStoreNames.contains('appConfig')) {
                db.createObjectStore('appConfig', { keyPath: 'chave' });
            }
        };

        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
    });
}

// F4.2 — Helper: insere ou substitui um objeto (upsert via put)
export async function salvar(storeName, objeto) {
    const db = await abrirBanco();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).put(objeto);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

// F4.2 — Helper: retorna todos os registros de uma store
export async function buscarTodos(storeName) {
    const db = await abrirBanco();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

// F4.9 helper — Retorna um unico registro pela chave primaria
export async function buscarUm(storeName, id) {
    const db = await abrirBanco();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror   = () => reject(req.error);
    });
}

// F4.2 — Helper: retorna registros filtrados por indice
export async function buscarPorIndice(storeName, indexName, valor) {
    const db = await abrirBanco();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(storeName, 'readonly');
        const idx = tx.objectStore(storeName).index(indexName);
        const req = idx.getAll(valor);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

// F4.2 — Helper: deleta um registro pela chave primaria
export async function deletar(storeName, id) {
    const db = await abrirBanco();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).delete(id);
        req.onsuccess = () => resolve();
        req.onerror   = () => reject(req.error);
    });
}

// F4.4 — Leitura paginada via cursor (ordem decrescente de chave = mais recente primeiro)
export async function buscarPaginado(storeName, pagina = 0, tamanhoPagina = 50) {
    const db = await abrirBanco();
    return new Promise((resolve, reject) => {
        const tx         = db.transaction(storeName, 'readonly');
        const resultados = [];
        const offset     = pagina * tamanhoPagina;
        let   saltado    = false;

        const req = tx.objectStore(storeName).openCursor(null, 'prev');
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) { resolve(resultados); return; }

            if (!saltado && offset > 0) {
                saltado = true;
                cursor.advance(offset);
                return;
            }

            resultados.push(cursor.value);
            if (resultados.length >= tamanhoPagina) { resolve(resultados); return; }
            cursor.continue();
        };
        req.onerror = () => reject(req.error);
    });
}

// F4.6 helper — Insere/substitui multiplos objetos em uma unica transacao
export async function salvarLote(storeName, objetos) {
    if (!objetos || objetos.length === 0) return;
    const db = await abrirBanco();
    return new Promise((resolve, reject) => {
        const tx    = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        objetos.forEach(obj => store.put(obj));
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
    });
}

// F4.5 — Migra jogos do localStorage para o IndexedDB na primeira execucao
export async function migrarLocalStorageParaIDB() {
    try {
        if (localStorage.getItem('idb_migrado')) return;
        const raw = localStorage.getItem('lotoSavedGames');
        if (raw) {
            const jogos = JSON.parse(raw);
            if (Array.isArray(jogos) && jogos.length > 0) {
                // Usa salvarLote para eficiencia — um unico commit de transacao
                await salvarLote('savedGames', jogos.filter(j => j && j.id));
            }
        }
        localStorage.setItem('idb_migrado', '1');
    } catch(e) { /* silencioso — nao bloqueia a inicializacao */ }
}
