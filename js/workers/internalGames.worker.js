import { analyzeInternalGames } from '../analytics/internalGames.js?v=5.5.0';
self.onmessage = ({data}) => {
    try {
        const result = analyzeInternalGames(data.selection, data.database, (current,total) => {
            self.postMessage({type:'progress',current,total});
        });
        self.postMessage({type:'result',result});
    } catch (error) {
        self.postMessage({type:'error',message:error.message || 'Erro ao analisar combinações.'});
    }
};
