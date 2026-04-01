const https = require('https');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Missing title' });

  const query = encodeURIComponent(title);
  const path = `/graph/v1/paper/search?query=${query}&fields=title,authors,abstract,externalIds,url,venue,year&limit=1`;

  const proxyReq = https.request({
    hostname: 'api.semanticscholar.org', port: 443, path, method: 'GET',
    headers: { 'User-Agent': 'SLR-Screener/1.0' },
  }, (proxyRes) => {
    let data = '';
    proxyRes.on('data', (chunk) => { data += chunk; });
    proxyRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const paper = parsed.data?.[0];
        if (!paper) return res.json({ found: false, title });
        res.json({
          found: true, title: paper.title,
          author: (paper.authors || []).map(a => a.name).join(', '),
          abstract: paper.abstract || '', venue: paper.venue || '', year: paper.year || '',
          doi: paper.externalIds?.DOI || '', arxiv_id: paper.externalIds?.ArXiv || '',
          url: paper.url || '',
        });
      } catch (err) { res.json({ found: false, title, error: err.message }); }
    });
  });
  proxyReq.on('error', (err) => res.status(502).json({ error: err.message }));
  proxyReq.end();
};
