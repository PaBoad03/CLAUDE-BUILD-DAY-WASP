import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { WaspEvent } from '@wasp/tools';
import type { Bus } from './bus.js';

const UI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../ui');

/**
 * Serves the ORANGE face (ui/index.html) and mirrors every bus event to the
 * browser over a local WebSocket. Read-only: the browser cannot publish.
 * If `packages/ui` (owner: Andrea) provides shared primitives, index.html
 * should adopt them; this server stays the same.
 */
export function startUiServer(bus: Bus, port: number): () => void {
  const html = readFileSync(resolve(UI_DIR, 'index.html'));
  const server = createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(404); res.end();
    }
  });
  const wss = new WebSocketServer({ server });
  const recent: WaspEvent[] = [];
  const unsub = bus.subscribe((e) => {
    recent.push(e); if (recent.length > 200) recent.shift();
    const msg = JSON.stringify(e);
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
  wss.on('connection', (c) => { for (const e of recent) c.send(JSON.stringify(e)); });
  server.listen(port, () => console.log(`🟠 ORANGE UI → http://localhost:${port}`));
  return () => { unsub(); wss.close(); server.close(); };
}
