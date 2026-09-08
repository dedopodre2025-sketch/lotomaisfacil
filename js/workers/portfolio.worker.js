import { generateBudgetPortfolio } from '../analytics/portfolio.js?v=5.6.0';
self.onmessage=({data})=>{
    try { self.postMessage({type:'result',result:generateBudgetPortfolio(data,p=>self.postMessage({type:'progress',...p}))}); }
    catch(e) {self.postMessage({type:'error',message:e.message});}
};
