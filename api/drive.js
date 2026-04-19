// Vercel serverless proxy for downloading Google Drive file contents.
//
// Why: Google Drive's direct-download URL (`drive.google.com/uc?export=download&id=...`)
// does NOT send permissive CORS headers, so browser fetch() calls get blocked.
// The `files/:id?alt=media` API endpoint requires OAuth unless the file is truly public,
// and even then CORS is inconsistent. Fetching server-side sidesteps all of this.
//
// Called from the browser like:
//   /api/drive?fileId=1AbC...&apiKey=AIza...
//
// Returns the raw file bytes. The apiKey is optional — if provided, we use the
// googleapis endpoint which is more reliable for large files. Otherwise we fall
// back to drive.google.com/uc which works for any publicly-shared file.

export default async function handler(req, res) {
  const { fileId, apiKey } = req.query;

  if (!fileId) {
    res.status(400).json({ error: 'fileId query param required' });
    return;
  }

  // Strategy: try the authenticated API endpoint first (works with API key for
  // public files and handles large files gracefully). Fall back to uc?export URL.
  const urls = apiKey
    ? [
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${encodeURIComponent(apiKey)}`,
        `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
      ]
    : [
        `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
      ];

  let lastError = null;
  for (const url of urls) {
    try {
      const upstream = await fetch(url, {
        headers: {
          'User-Agent': 'BLW-Content-Hub-Drive/1.0',
          'Accept': '*/*',
        },
        redirect: 'follow',
      });

      if (!upstream.ok) {
        lastError = `HTTP ${upstream.status} from ${url.split('?')[0]}`;
        continue;
      }

      // Stream the body back
      const buf = Buffer.from(await upstream.arrayBuffer());
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';

      // If Drive sent us a "virus scan warning" HTML page (happens for files > 100MB
      // on the uc endpoint), detect and surface a helpful error instead of saving HTML
      // as an image.
      if (contentType.startsWith('text/html') && buf.length < 200000) {
        lastError = 'Drive returned an HTML page (file may be too large for uc endpoint — use API key mode, or reduce file size)';
        continue;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.status(200).send(buf);
      return;
    } catch (err) {
      lastError = err.message;
      continue;
    }
  }

  res.status(502).json({ error: 'All download strategies failed', detail: lastError });
}
