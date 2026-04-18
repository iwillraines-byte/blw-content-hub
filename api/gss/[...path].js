// Vercel serverless proxy for app.grandslamsystems.com
// The upstream API only allows CORS from prowiffleball.com, so browser calls
// from our Vercel domain are blocked. This proxy forwards requests server-side
// (no CORS) and returns the response to the browser with same-origin headers.

export default async function handler(req, res) {
  const { path = [] } = req.query;
  const pathArr = Array.isArray(path) ? path : [path];
  const pathStr = pathArr.join('/');

  // Forward any query params except the 'path' param itself
  const forwardQs = Object.entries(req.query)
    .filter(([k]) => k !== 'path')
    .map(([k, v]) => {
      const values = Array.isArray(v) ? v : [v];
      return values.map(val => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`).join('&');
    })
    .filter(Boolean)
    .join('&');

  const upstreamUrl = `https://app.grandslamsystems.com/api/${pathStr}${forwardQs ? '?' + forwardQs : ''}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        'User-Agent': 'BLW-Content-Hub-Proxy/1.0',
        'Accept': 'application/json',
      },
    });

    const body = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'application/json';

    // Short edge cache so we don't hammer the upstream on every page load
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('Content-Type', contentType);
    res.status(upstream.status).send(body);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(502).json({ error: 'Upstream fetch failed', message: error.message });
  }
}
