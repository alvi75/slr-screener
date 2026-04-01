const https = require('https');

function fetchPaper(title) {
  return new Promise((resolve) => {
    const query = encodeURIComponent(title);
    const path = `/graph/v1/paper/search?query=${query}&fields=title,authors,abstract,externalIds,url,venue,year&limit=1`;
    const r = https.request({
      hostname: 'api.semanticscholar.org', port: 443, path, method: 'GET',
      headers: { 'User-Agent': 'SLR-Screener/1.0' },
    }, (proxyRes) => {
      let d = '';
      proxyRes.on('data', (c) => { d += c; });
      proxyRes.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          const paper = parsed.data?.[0];
          if (paper) {
            resolve({
              found: true, originalTitle: title, title: paper.title,
              author: (paper.authors || []).map(a => a.name).join(', '),
              abstract: paper.abstract || '', venue: paper.venue || '', year: paper.year || '',
              doi: paper.externalIds?.DOI || '', arxiv_id: paper.externalIds?.ArXiv || '',
            });
          } else {
            resolve({ found: false, originalTitle: title });
          }
        } catch (err) {
          resolve({ found: false, originalTitle: title, error: err.message });
        }
      });
    });
    r.on('error', (err) => resolve({ found: false, originalTitle: title, error: err.message }));
    r.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { titles } = req.body;
  if (!Array.isArray(titles)) return res.status(400).json({ error: 'Missing titles array' });

  const results = [];
  for (let i = 0; i < titles.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1000));
    results.push(await fetchPaper(titles[i]));
  }
  res.json({ results });
};
