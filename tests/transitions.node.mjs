import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeTransitions} from '../js/analytics/transitions.js';
import {readFileSync} from 'node:fs';
test('usa apenas concursos consecutivos; ordem não altera resultado',()=>{
 const rows=[{id:1,nums:Array.from({length:15},(_,i)=>i+1)},{id:2,nums:Array.from({length:15},(_,i)=>i+11)},{id:100,nums:Array.from({length:15},(_,i)=>i+1)}];
 const r=summarizeTransitions(rows);
 assert.equal(r.total,1);assert.deepEqual(r.counts.repeats,{'5':1});
 assert.deepEqual(r,summarizeTransitions([...rows].reverse()));
 assert.equal(r.entry[25],1);assert.equal(r.exit[1],1);
});
test('base completa tem 3778 transições e moda 9, independente de filtro',()=>{
 const text=readFileSync(new URL('../js/data/defaultData.js',import.meta.url),'utf8');
 // Mesmo formato de dados utilizado pelo app.
 return import('../js/data/defaultData.js').then(m=>{
  const r=summarizeTransitions(m.DEFAULT_HISTORY.split('\n').map(line=>{const [id,nums]=line.split(' - ');return {id:Number(id),nums:nums.split(',').map(Number)};}));
  assert.equal(r.total,3778);
  const mode=Object.entries(r.counts.repeats).sort((a,b)=>b[1]-a[1])[0][0];
  assert.equal(mode,'9');
 });
});
test('simulação histórica aparece antes da carteira e após salvar',()=>{
 const s=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const save=s.indexOf('onclick="saveCurrentGame()"'),hits=s.indexOf('id="hits-11"'),portfolio=s.indexOf('id="portfolio-panel"');
 assert.ok(save<hits&&hits<portfolio);
 assert.equal(s.split('id="hits-11"').length,2);
});
