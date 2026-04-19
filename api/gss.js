// Vercel serverless proxy for app.grandslamsystems.com
// Upstream API has a CORS whitelist (only prowiffleball.com allowed), so browser
// calls from our Vercel domain are blocked. This proxy forwards server-side.
//
// Called via either:
//   /api/gss?path=leagues/3/batting-stats&showAll=true
//   /api/gss/leagues/3/batting-stats?showAll=true  (rewritten by vercel.json)

export default async function handler(req, res) {
  let { path, ...rest } = req.query;
  if (Array.isArray(path)) path = path.join('/');
  if (!path) {
    res.status(400).json({ error: 'path query param required' });
    return;
  }

  // Forward any additional query params
  const qs = Object.entries(rest)
    .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map(val => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`))
    .join('&');

  const upstreamUrl = `https://app.grandslamsystems.com/api/${path}${qs ? '?' + qs : ''}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        'User-Agent': 'BLW-Content-Hub-Proxy/1.0',
        'Accept': 'application/json',
      },
    });

    const body = await upstream.text();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.status(upstream.status).send(body);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(502).json({ error: 'Upstream fetch failed', message: error.message });
  }
}
