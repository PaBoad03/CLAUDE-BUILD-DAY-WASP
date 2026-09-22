/**
 * Serves the GREEN face UI on http://localhost:4004
 * The UI connects to the hub WebSocket given by ?hub=ws://host:port (or uses demo mode).
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = join(here, '..', 'ui', 'index.html');
const port = Number(process.env['GREEN_UI_PORT'] ?? 4004);

createServer((req, res) => {
  if (req.url === '/' || req.url?.startsWith('/?')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(html));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(port, () => {
  console.log(`GREEN UI  → http://localhost:${port}/?demo=1`);
  console.log(`with hub  → http://localhost:${port}/?hub=ws://localhost:8787`);
});
