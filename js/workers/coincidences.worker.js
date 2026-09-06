function bitCount(n) {
    n = n - ((n >> 1) & 0x55555555);
    n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
    return (((n + (n >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;
}

self.onmessage = function(e) {
    const masks = e.data;
    const len = masks.length;
    const results = new Array(len);
    for (let i = 0; i < len; i++) {
        let max = 0, count = 0, count12 = 0;
        const m1 = masks[i].mask;
        for (let j = 0; j < len; j++) {
            if (i === j) continue;
            const matches = bitCount(m1 & masks[j].mask);
            if (matches > max) { max = matches; count = 1; }
            else if (matches === max) { count++; }
            if (matches === 12) { count12++; }
        }
        results[i] = { id: masks[i].id, maxCoincidence: max, maxCoincidenceCount: count, maxCoincidence12Count: count12 };
    }
    self.postMessage({ type: 'result', results });
};