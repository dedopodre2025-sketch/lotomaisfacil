import { TOTAL_RESULTS } from '../analytics/portfolio.js?v=5.5.0';
import { exportInternalGames } from '../analytics/internalGames.js?v=5.5.0';
export function createPortfolioPanel(getSaved) {
    const el=id=>document.getElementById('portfolio-'+id);
    let worker=null,result=null,request=0;
    const money=n=>(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    const pct=n=>(100*n/TOTAL_RESULTS).toLocaleString('pt-BR',{minimumFractionDigits:6,maximumFractionDigits:8})+'%';
    function stop() {request++;worker?.terminate();worker=null;el('run').disabled=false;el('cancel').hidden=true;el('panel').setAttribute('aria-busy','false');}
    function invalidate() {stop();result=null;el('result').hidden=true;el('export').disabled=true;el('status').textContent='Configuração alterada. Gere novamente para atualizar a carteira.';}
    for(const id of ['budget','price','saved']) el(id).addEventListener('change',invalidate);
    el('cancel').onclick=()=>{stop();el('status').textContent='Geração cancelada.';};
    el('run').onclick=async()=>{
        invalidate();const token=request;
        el('run').disabled=true;el('cancel').hidden=false;el('panel').setAttribute('aria-busy','true');
        el('status').textContent='Preparando carteira…';
        try {
            const saved=el('saved').checked?await getSaved():[];
            if(token!==request) return;
            worker=new Worker(new URL('../workers/portfolio.worker.js?v=5.5.0',import.meta.url),{type:'module'});
            worker.onerror=()=>{stop();el('status').textContent='Falha ao carregar o motor. Atualize a página e tente novamente.';};
            worker.onmessage=({data})=>{
                if(data.type==='progress') {el('status').textContent=(data.phase==='base'?'Analisando salvos: ':'Gerando jogos: ')+data.done+'/'+data.total;return;}
                stop();
                if(data.type==='error') {el('status').textContent=data.message;return;}
                result=data.result;
                el('status').textContent='Cálculo concluído. Cobertura exata; seleção heurística, sem previsão do sorteio.';
                el('summary').textContent=result.tickets.length+' jogos novos · '+result.existingUnique+' combinações únicas salvas · '+result.duplicates+' combinações repetidas nos salvos. Custo total: '+money(result.costCents)+' · saldo: '+money(result.remainingCents)+'.';
                el('coverage').replaceChildren();
                for(const k of [13,14,15]) {
                    const tr=document.createElement('tr');
                    for(const value of [k===15?'15 pontos':k+' ou mais',pct(result.before[k]),pct(result.after[k]),(100*(result.after[k]-result.before[k])/TOTAL_RESULTS).toLocaleString('pt-BR',{maximumFractionDigits:8})+' p.p.']) {
                        const td=document.createElement('td');td.textContent=value;tr.append(td);
                    }
                    el('coverage').append(tr);
                }
                el('games').textContent=result.tickets.map((g,i)=>String(i+1).padStart(3,'0')+'  '+g.nums.map(n=>String(n).padStart(2,'0')).join(' ')).join('\n')||'Nenhum jogo novo cabe no saldo do orçamento.';
                el('optimal').textContent=result.certified13?'Esta carteira atingiu o limite matemático de cobertura de 13+ para esta quantidade de jogos simples distintos.':'Busca por maior cobertura de 13+ entre candidatos. Não há garantia de melhor carteira possível.';
                el('result').hidden=false;el('export').disabled=!result.tickets.length;
            };
            const seed=crypto.getRandomValues(new Uint32Array(1))[0];
            worker.postMessage({budget:el('budget').value,price:el('price').value,saved,seed});
        } catch(e) {if(token===request){stop();el('status').textContent=e.message;}}
    };
    el('export').onclick=()=>{
        if(!result?.tickets.length)return;
        const url=URL.createObjectURL(new Blob([exportInternalGames(result.tickets)],{type:'text/plain;charset=utf-8'}));
        const a=document.createElement('a');a.href=url;a.download='carteira_'+result.tickets.length+'jogos_seed'+result.seed+'.txt';a.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
}
