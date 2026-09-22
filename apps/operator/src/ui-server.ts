import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const UI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../ui');

/**
 * Serves the ORANGE face (ui/index.html) as a static page. The page itself connects
 * to the WASP HUB as `operator` with meta.role = 'ui' (docs/CONTRACT.md §2), so there is
 * no per-agent relay: one hub, one stream, four faces.
 */
export function startUiServer(port: number, hubUrl: string): () => void {
  const html = readFileSync(resolve(UI_DIR, 'index.html'), 'utf8').replaceAll('__WASP_HUB_URL__', hubUrl);
  const server = createServer((req, res) => {
    if (req.url === '/' || req.url?.startsWith('/index.html') || req.url?.startsWith('/?')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port, () => console.log(`[orange] ORANGE face → http://localhost:${port}  (hub ${hubUrl})`));
  return () => server.close();
}
