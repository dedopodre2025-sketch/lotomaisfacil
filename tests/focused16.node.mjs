import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareHistory,evaluate16,search16,better} from '../js/analytics/focused16.js';
import {combinations15,mask15} from '../js/analytics/internalGames.js';
import {DEFAULT_HISTORY} from '../js/data/defaultData.js';
const db=DEFAULT_HISTORY.split('\n').map(line=>{const [id,nums]=line.split(' - ');return {id:Number(id),nums:nums.split(',').map(Number)};});
test('contagens coincidem com enumeração independente das 16 combinações',()=>{
 const r=search16({database:db,cap:13,attempts:200,seed:19});
 assert.ok(r.best);const b=r.best,dist={};let n12=0,n13=0;const c12=new Set(),c13=new Set();
 for(const g of combinations15(b.nums)){
  let max=0;const set=new Set(g);
  for(const c of db){const k=c.nums.filter(n=>set.has(n)).length;max=Math.max(max,k);
   if(k===12){n12++;c12.add(c.id);}if(k===13){n13++;c13.add(c.id);}
  }
  dist[max]=(dist[max]||0)+1;
 }
 assert.deepEqual(b.maxCounts,dist);assert.equal(b.occurrences12,n12);assert.equal(b.occurrences13,n13);
 assert.equal(b.contests12,c12.size);assert.equal(b.contests13,c13.size);assert.ok(Math.max(...Object.keys(dist).map(Number))<=13);
});
test('teto não é flexibilizado; reconhece sobreposição nos salvos',()=>{
 const nums=Array.from({length:16},(_,i)=>i+1);
 const hist=prepareHistory([{id:1,nums:Array.from({length:15},(_,i)=>i+4)}]); // 13 comuns
 assert.equal(evaluate16(nums,hist,12),null);
 const r=evaluate16(nums,hist,13,new Set([mask15(nums.slice(0,15))]));
 assert.equal(r.duplicates,1);assert.equal(r.newCombinations,15);
 assert.equal(r.occurrences13,3);assert.equal(r.occurrences12,13);
});
test('ranking lexicográfico e busca completa reprodutível',()=>{
 assert.ok(better({rank:[0,2,20,500]},{rank:[0,3,3,1]}));
 assert.ok(better({rank:[0,5,20,500]},{rank:[1,1,1,1]}));
 const a=search16({database:db.slice(0,20),cap:13,attempts:30,seed:1});
 assert.equal(a.attempts,30);assert.ok(a.examined>1);
 assert.deepEqual(a,search16({database:db.slice(0,20),cap:13,attempts:30,seed:1}));
 assert.throws(()=>search16({database:[],cap:12}));
});
test('falha retorna best nulo, nunca candidato inválido',()=>{
 const probe=search16({database:db.slice(0,1),cap:13,attempts:1,seed:2});
 const history=[{id:1,nums:probe.best.nums.slice(0,15)}];
 const r=search16({database:history,cap:12,attempts:1,seed:2});
 assert.equal(r.best,null);assert.equal(r.valid,0);
});
test('Worker carrega e retorna o teto solicitado',async()=>{
 const {Worker}=await import('node:worker_threads');
 const url=new URL('../js/workers/focused16.worker.js',import.meta.url).href;
 const code="const {parentPort}=require('node:worker_threads');global.self={postMessage:m=>parentPort.postMessage(m)};import("+JSON.stringify(url)+").then(()=>parentPort.on('message',data=>self.onmessage({data})));";
 const w=new Worker(code,{eval:true});
 try{
  const r=await new Promise((resolve,reject)=>{w.on('error',reject);w.on('message',m=>{if(m.type==='result')resolve(m.result);if(m.type==='error')reject(new Error(m.message));});w.postMessage({database:db.slice(0,20),cap:13,attempts:20});});
  assert.equal(r.cap,13);assert.ok(r.best);assert.ok(r.examined>1);
 }finally{await w.terminate();}
});
