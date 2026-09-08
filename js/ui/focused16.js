export function createFocused16Panel(getState,getSaved,apply) {
 const el=id=>document.getElementById('focused16-'+id);
 let worker=null,token=0;
 function invalidate(){
  token++;worker?.terminate();worker=null;
  el('cancel').hidden=true;el('summary').hidden=true;
  el('status').textContent='Escolha um teto histórico para buscar conjuntos de 16.';
 }
 el('cancel').onclick=()=>{invalidate();el('status').textContent='Busca cancelada. Sua seleção foi mantida.';};
 for(const id of ['saved','attempts'])el(id).onchange=invalidate;
 async function run(cap){
  invalidate();const current=token;
  el('cancel').hidden=false;el('status').textContent='Preparando busca…';
  try {
   const database=getState().database.map(c=>({id:c.id,nums:[...c.nums]}));
   const saved=el('saved').checked?await getSaved():[];
   if(current!==token)return;
   worker=new Worker(new URL('../workers/focused16.worker.js?v=5.6.0',import.meta.url),{type:'module'});
   worker.onerror=()=>{invalidate();el('status').textContent='Falha no motor. Sua seleção foi mantida.';};
   worker.onmessage=({data})=>{
    if(current!==token)return;
    if(data.type==='progress'){el('status').textContent=data.done+'/'+data.total+' tentativas · '+data.examined+' conjuntos distintos · '+data.valid+' válidos.';return;}
    worker.terminate();worker=null;el('cancel').hidden=true;
    if(data.type==='error'){el('status').textContent=data.message;return;}
    const r=data.result;
    if(!r.best){el('status').textContent='Nenhum conjunto com teto '+cap+' encontrado entre '+r.examined+' candidatos distintos. Isso não prova inexistência. Sua seleção foi mantida.';return;}
    apply(r.best.nums);
    el('status').textContent='Melhor encontrado segundo o filtro entre '+r.examined+' candidatos distintos ('+r.valid+' válidos). Teto '+cap+' respeitado nos 16 jogos internos.';
    const b=r.best,dist=Object.entries(b.maxCounts).sort((a,b)=>Number(a[0])-Number(b[0])).map(([k,n])=>n+' com máximo '+k).join('; ');
    el('summary').textContent='Base: '+r.historyCount+' concursos. Jogos internos: '+dist+
      '. Ocorrências de 13: '+b.occurrences13+' em '+b.contests13+' concursos distintos. Ocorrências de 12: '+b.occurrences12+' em '+b.contests12+
      ' concursos distintos.'+(saved.length?' Comparação com salvos: '+b.newCombinations+' combinações novas; '+b.duplicates+' já cobertas.':'')+
      ' Semente: '+r.seed+'.';
    el('summary').hidden=false;
   };
   worker.postMessage({database,cap,saved,attempts:Number(el('attempts').value),seed:crypto.getRandomValues(new Uint32Array(1))[0]});
  }catch(e){if(current===token){invalidate();el('status').textContent=e.message;}}
 }
 return {run,invalidate};
}
