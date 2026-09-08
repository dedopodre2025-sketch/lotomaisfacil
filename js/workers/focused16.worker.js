import {search16} from '../analytics/focused16.js?v=5.6.0';
self.onmessage=({data})=>{try{self.postMessage({type:'result',result:search16(data,p=>self.postMessage({type:'progress',...p}))});}catch(e){self.postMessage({type:'error',message:e.message});}};
