/** Persistência local testável e compatível com a aplicação principal. */
const PRIMARY_KEY = 'lotoSavedGames';
const LEGACY_KEY = 'savedGames';

function notify(message, type = 'info') {
  if (typeof globalThis.showToast === 'function') globalThis.showToast(message, type);
}

function validNums(nums) {
  const arr = nums instanceof Set ? Array.from(nums) : nums;
  return Array.isArray(arr)
    && arr.length >= 15 && arr.length <= 17
    && new Set(arr).size === arr.length
    && arr.every(n => Number.isInteger(n) && n >= 1 && n <= 25);
}

export function carregarJogosDoStorage() {
  for (const key of [PRIMARY_KEY, LEGACY_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) { /* tenta chave seguinte */ }
  }
  return [];
}

export function salvarJogoNoStorage(jogo) {
  if (!jogo || !validNums(jogo.nums)) return false;
  const jogos = carregarJogosDoStorage();
  const idx = jogos.findIndex(j => String(j.id) === String(jogo.id));
  if (idx >= 0) jogos[idx] = jogo; else jogos.unshift(jogo);
  try {
    localStorage.setItem(PRIMARY_KEY, JSON.stringify(jogos));
    return true;
  } catch (e) {
    notify('Erro: sem espaço suficiente no armazenamento local (quota excedida).', 'error');
    return false;
  }
}

export function saveCurrentGame(nums) {
  const arr = nums instanceof Set ? Array.from(nums) : nums;
  if (!validNums(arr)) return false;
  const sorted = [...arr].sort((a,b)=>a-b);
  const jogos = carregarJogosDoStorage();
  if (jogos.some(j => Array.isArray(j.nums) && [...j.nums].sort((a,b)=>a-b).join(',') === sorted.join(','))) return false;
  const jogo = {
    id: Date.now(),
    nums: sorted,
    dataSalvo: new Date().toISOString(),
    date: new Date().toLocaleString('pt-BR'),
    score: '--',
    count: sorted.length,
  };
  return salvarJogoNoStorage(jogo);
}

export async function migrarLocalStorageParaIDB() {
  if (localStorage.getItem('idb_migrated') === 'true') return;
  try {
    const raw = localStorage.getItem(PRIMARY_KEY) || localStorage.getItem(LEGACY_KEY);
    const jogos = raw ? JSON.parse(raw) : [];
    if (typeof indexedDB !== 'undefined' && Array.isArray(jogos) && jogos.length) {
      const { salvarLote } = await import('./db.js');
      await salvarLote('savedGames', jogos.filter(j => j && j.id != null && validNums(j.nums)));
    }
  } catch (_) {
    // Migração não deve bloquear o app. O backup local permanece intacto.
  } finally {
    try {
      localStorage.setItem('idb_migrated', 'true');
      localStorage.setItem('idb_migrado', '1');
    } catch (_) {}
  }
}
