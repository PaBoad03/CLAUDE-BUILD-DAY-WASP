/**
 * Serves the GREEN face (ui/index.html) as a static page. The page connects to the hub
 * itself as `security` with meta.role = 'ui' (docs/CONTRACT.md §2) and sends the human's
 * SÍ / NO / STOP buttons as `user_authorization` through the hub's HTTP bridge.
 *
 *   npm run ui -w @wasp/security        (standalone; `npm run security` already serves it)
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveHubUrl } from '@wasp/event-bus';

const here = dirname(fileURLToPath(import.meta.url));

export function startUiServer(port: number, hubUrl: string): () => void {
  const html = readFileSync(join(here, '..', 'ui', 'index.html'), 'utf8').replaceAll('__WASP_HUB_URL__', hubUrl);
  const server = createServer((req, res) => {
    if (req.url === '/' || req.url?.startsWith('/?') || req.url?.startsWith('/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, () => console.log(`[green] GREEN face → http://localhost:${port}  (hub ${hubUrl})`));
  return () => server.close();
}

if (process.argv[1] && /serve-ui\.ts$/.test(process.argv[1])) {
  startUiServer(Number(process.env.WASP_SECURITY_UI_PORT ?? 7004), resolveHubUrl());
}
