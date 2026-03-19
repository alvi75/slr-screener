const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.post('/api/score', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(400).json({ error: 'Missing x-api-key header' });
  }

  const body = JSON.stringify(req.body);

  const options = {
    hostname: 'api.anthropic.com',
    port: 443,
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-length': Buffer.byteLength(body),
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    let data = '';
    proxyRes.on('data', (chunk) => { data += chunk; });
    proxyRes.on('end', () => {
      res.status(proxyRes.statusCode).set('content-type', 'application/json').send(data);
    });
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.status(502).json({ error: 'Proxy error: ' + err.message });
  });

  proxyReq.write(body);
  proxyReq.end();
});

// Semantic Scholar single title lookup
app.post('/api/semantic-scholar/search', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Missing title' });
  const query = encodeURIComponent(title);
  const path = `/graph/v1/paper/search?query=${query}&fields=title,authors,abstract,externalIds,url,venue,year&limit=1`;
  const options = { hostname: 'api.semanticscholar.org', port: 443, path, method: 'GET',
    headers: { 'User-Agent': 'SLR-Screener/1.0' } };
  const proxyReq = https.request(options, (proxyRes) => {
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
});

// Semantic Scholar batch lookup (with rate limiting)
app.post('/api/semantic-scholar/batch', async (req, res) => {
  const { titles } = req.body;
  if (!Array.isArray(titles)) return res.status(400).json({ error: 'Missing titles array' });
  const results = [];
  for (let i = 0; i < titles.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1000)); // rate limit
    try {
      const query = encodeURIComponent(titles[i]);
      const path = `/graph/v1/paper/search?query=${query}&fields=title,authors,abstract,externalIds,url,venue,year&limit=1`;
      const data = await new Promise((resolve, reject) => {
        const r = https.request({ hostname: 'api.semanticscholar.org', port: 443, path, method: 'GET',
          headers: { 'User-Agent': 'SLR-Screener/1.0' } }, (proxyRes) => {
          let d = '';
          proxyRes.on('data', (c) => { d += c; });
          proxyRes.on('end', () => resolve(d));
        });
        r.on('error', reject);
        r.end();
      });
      const parsed = JSON.parse(data);
      const paper = parsed.data?.[0];
      if (paper) {
        results.push({
          found: true, originalTitle: titles[i], title: paper.title,
          author: (paper.authors || []).map(a => a.name).join(', '),
          abstract: paper.abstract || '', venue: paper.venue || '', year: paper.year || '',
          doi: paper.externalIds?.DOI || '', arxiv_id: paper.externalIds?.ArXiv || '',
        });
      } else {
        results.push({ found: false, originalTitle: titles[i] });
      }
    } catch (err) {
      results.push({ found: false, originalTitle: titles[i], error: err.message });
    }
  }
  res.json({ results });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`[Proxy] Claude API proxy running on http://localhost:${PORT}`);
});
