import { combinations15, mask15, TOTAL_RESULTS } from './internalGames.js?v=5.6.0';
export { TOTAL_RESULTS };
export function cents(value) {
    const s=String(value).trim().replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error('Informe valores positivos com até duas casas decimais.');
    const [a,b='']=s.split('.');
    const n=Number(a)*100+Number(b.padEnd(2,'0'));
    if (!Number.isSafeInteger(n) || n<=0) throw new Error('Valor inválido.');
    return n;
}
export function expandSaved(saved) {
    const unique=new Map(); let paid=0;
    for (const row of saved) {
        const games=combinations15(row.nums || row);
        paid+=games.length;
        if(paid>10000) throw new Error('Limite de análise: 10.000 combinações salvas. Selecione uma carteira menor.');
        for(const nums of games) unique.set(mask15(nums),nums);
    }
    return {games:[...unique.values()],paid,duplicates:paid-unique.size};
}
// Primeiro o próprio jogo, depois 150 resultados de 14 pontos e 4.725 de 13.
export function neighborhood(nums) {
    const m=mask15(nums), a=nums.map(n=>1<<(n-1)), b=[];
    for(let i=0;i<25;i++) if(!(m&(1<<i))) b.push(1<<i);
    const out=new Int32Array(4876); let p=0; out[p++]=m;
    for(const x of a) for(const y of b) out[p++]=m^x^y;
    for(let i=0;i<15;i++) for(let j=i+1;j<15;j++)
        for(let k=0;k<10;k++) for(let l=k+1;l<10;l++)
            out[p++]=m^a[i]^a[j]^b[k]^b[l];
    return out;
}
export function coverageIndex() {
    const flags=new Uint8Array(1<<25), counts={13:0,14:0,15:0};
    function visit(out,write) {
        const gain={13:0,14:0,15:0};
        for(let i=0;i<out.length;i++) {
            const bits=i===0?7:i<=150?3:1, old=flags[out[i]], added=bits&~old;
            if(added&1) gain[13]++;
            if(added&2) gain[14]++;
            if(added&4) gain[15]++;
            if(write) flags[out[i]]=old|bits;
        }
        if(write) for(const k of [13,14,15]) counts[k]+=gain[k];
        return gain;
    }
    return {counts,has:m=>Boolean(flags[m]&4),add:out=>visit(out,true),gain:out=>visit(out,false)};
}
export function generateBudgetPortfolio({budget='35',price='3.50',saved=[],seed=1,candidates=64},progress=()=>{}) {
    const budgetCents=cents(budget), priceCents=cents(price);
    if(!Number.isInteger(candidates)||candidates<1||candidates>256) throw new Error('Busca inválida.');
    const base=expandSaved(saved), existingCost=base.paid*priceCents;
    const count=Math.floor((budgetCents-existingCost)/priceCents);
    if(count<0) throw new Error('Os jogos salvos excedem este orçamento total.');
    if(count>200) throw new Error('Limite de 200 jogos novos por geração. Reduza o orçamento desta carteira.');
    const index=coverageIndex();
    base.games.forEach((g,i)=>{index.add(neighborhood(g)); if(i%100===0)progress({phase:'base',done:i+1,total:base.games.length});});
    const before={...index.counts};
    let state=seed>>>0;
    const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
    const tickets=[];
    for(let t=0;t<count;t++) {
        let best;
        for(let c=0;c<candidates;c++) {
            const a=Array.from({length:25},(_,i)=>i+1);
            for(let i=24;i>9;i--) {const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
            const nums=a.slice(10).sort((a,b)=>a-b);
            if(index.has(mask15(nums))) continue;
            const out=neighborhood(nums),gain=index.gain(out);
            if(!best||gain[13]>best.gain[13]||(gain[13]===best.gain[13]&&gain[14]>best.gain[14])) best={nums,out,gain};
        }
        if(!best) throw new Error('Não foi possível gerar jogo distinto. Tente outra geração.');
        index.add(best.out);tickets.push({nums:best.nums,gain:best.gain});
        progress({phase:'generate',done:t+1,total:count});
    }
    const costCents=existingCost+count*priceCents;
    return {tickets,before,after:{...index.counts},existingPaid:base.paid,existingUnique:base.games.length,
        duplicates:base.duplicates,budgetCents,priceCents,costCents,remainingCents:budgetCents-costCents,
        seed:seed>>>0,certified13:index.counts[13]===Math.min(TOTAL_RESULTS,(base.games.length+count)*4876)};
}
