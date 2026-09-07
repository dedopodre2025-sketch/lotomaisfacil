import { filterInternalGames, exportInternalGames, TOTAL_RESULTS } from '../analytics/internalGames.js?v=5.5.0';

export function createInternalGamesPanel(getState) {
    const el = id => document.getElementById('internal-'+id);
    const root = el('panel');
    if (!root) return {invalidate(){}};
    let worker = null, result = null, page = 0;
    const pageSize = 25;
    const number = n => n.toLocaleString('pt-BR');
    const percent = n => (100*n).toLocaleString('pt-BR',{maximumFractionDigits:4})+'%';
    const chance = n => (100*n).toLocaleString('pt-BR',{maximumFractionDigits:8})+'%';
    function stop() { if (worker) worker.terminate(); worker = null; root.setAttribute('aria-busy','false'); }
    function ready() {
        const state = getState();
        return state.selection.length >= 15 && state.selection.length <= 18 && state.database.length > 0;
    }
    function invalidate() {
        stop(); result = null; page = 0;
        el('results').hidden = true; el('export').disabled = true;
        el('run').disabled = !ready();
        el('run').textContent = 'Analisar combinações de 15';
        el('cancel').hidden = true;
        const {selection,database} = getState();
        el('status').textContent = !database.length ? 'Importe uma base na aba Dados.' :
            selection.length < 15 ? 'Selecione de 15 a 18 dezenas no volante.' :
            'Seleção de '+selection.length+' dezenas · base com '+number(database.length)+' concursos. Clique para analisar.';
    }
    function render() {
        if (!result) return;
        el('results').hidden = false;
        el('base').textContent = number(result.historyCount)+' concursos · '+result.oldest+' a '+result.newest+
            ' · '+result.selection.map(n=>String(n).padStart(2,'0')).join(' ');
        el('total').textContent = number(result.total);
        for (const [key,count] of Object.entries(result.counts)) {
            el(key).textContent = number(count);
            el(key+'-percent').textContent = percent(count/result.total)+' dos jogos';
        }
        const games = filterInternalGames(result,el('filter').value);
        const pages = Math.max(1,Math.ceil(games.length/pageSize));
        page = Math.min(page,pages-1);
        el('filtered').textContent = number(games.length)+' de '+number(result.total)+' jogos no filtro';
        el('probability').textContent = 'Chance matemática de 15: seleção completa '+chance(result.fullProbability15)+
            ' · somente os jogos do filtro '+chance(games.length/TOTAL_RESULTS)+'. Sorteio uniforme; cada jogo distinto contado uma vez.';
        el('export').disabled = games.length === 0;
        el('rows').replaceChildren();
        for (const game of games.slice(page*pageSize,(page+1)*pageSize)) {
            const tr = document.createElement('tr');
            const values = [game.nums.map(n=>String(n).padStart(2,'0')).join(' '),String(game.max),
                number(game.maxCount),game.exampleContest];
            values.forEach((value,index) => {
                const td = document.createElement('td'); td.textContent = value;
                if(index===0) td.className='internal-numbers';
                tr.appendChild(td);
            });
            el('rows').appendChild(tr);
        }
        el('empty').hidden = games.length !== 0;
        el('pagination').hidden = games.length <= pageSize;
        el('page').textContent = 'Página '+(page+1)+' de '+pages;
        el('prev').disabled = page === 0; el('next').disabled = page+1 >= pages;
    }
    el('run').addEventListener('click',() => {
        invalidate();
        if (!ready()) return;
        const {selection,database} = getState();
        el('run').disabled = true; el('cancel').hidden = false;
        root.setAttribute('aria-busy','true'); el('status').textContent = 'Analisando os jogos internos…';
        try {
            worker = new Worker(new URL('../workers/internalGames.worker.js?v=5.5.0',import.meta.url),{type:'module'});
            const active = worker;
            worker.onmessage = ({data}) => {
                if (worker !== active) return;
                if (data.type === 'progress') el('status').textContent = 'Analisados '+number(data.current)+' de '+number(data.total)+' jogos.';
                if (data.type === 'result') {
                    result = data.result; stop();
                    el('cancel').hidden = true; el('run').disabled = false;
                    el('status').textContent = 'Análise concluída. As classes abaixo são máximos históricos por jogo.';
                    render();
                }
                if (data.type === 'error') fail(data.message);
            };
            worker.onerror = () => fail('Não foi possível carregar o analisador. Recarregue a página e confira se todos os arquivos da atualização foram enviados.');
            worker.postMessage({selection,database:database.map(c=>({id:c.id,nums:c.nums}))});
        } catch (error) { fail('Não foi possível iniciar a análise: '+error.message); }
    });
    function fail(message) { stop(); el('status').textContent = message; el('run').disabled = !ready(); el('cancel').hidden = true; }
    el('cancel').addEventListener('click',() => {invalidate(); el('status').textContent = 'Análise cancelada.';});
    el('filter').addEventListener('change',()=>{page=0;render();});
    el('prev').addEventListener('click',()=>{page--;render();});
    el('next').addEventListener('click',()=>{page++;render();});
    el('export').addEventListener('click',()=>{
        if (!result) return;
        const games = filterInternalGames(result,el('filter').value);
        if (!games.length) return;
        const url = URL.createObjectURL(new Blob([exportInternalGames(games)],{type:'text/plain;charset=utf-8'}));
        const link = document.createElement('a'); link.href = url;
        link.download = 'jogos15_'+result.selection.length+'dezenas_'+el('filter').value+'_base'+result.newest+'.txt';
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    invalidate();
    return {invalidate};
}
