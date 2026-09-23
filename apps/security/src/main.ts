/**
 * GREEN entrypoint. Connects to the WASP HUB (docs/CONTRACT.md) as `security`.
 *
 *   npm run security                                   # Pablo's PC (hub on localhost)
 *   WASP_HUB_URL=ws://<pablo-ip>:7331 npm run security   # Juanda's PC
 *
 * Env:
 *   WASP_HUB_URL                 hub address (default ws://localhost:7331)
 *   WASP_SECURITY_LANG           es | en (spoken lines). Default es
 *   WASP_PERMISSION_TIMEOUT_MS   expire pending permissions after N ms. Default 0 = never (live demo)
 *   GREEN face: npm run security:ui  (Vite + @wasp/ui on http://localhost:7004)
 *
 * Solo rehearsal on one PC:  npm run hub · npm run stubs -- researcher operator · npm run security · npm run architect
 */

import os from 'node:os';
import path from 'node:path';
import { connectHub } from '@wasp/event-bus';
import { AuditLog } from '@wasp/audit';
import { SecurityAgent } from '@wasp/permissions';

const log = (m: string) => console.log(`[green ${new Date().toISOString().slice(11, 19)}] ${m}`);
const lang = (process.env.WASP_SECURITY_LANG === 'en' ? 'en' : 'es') as 'es' | 'en';

const hub = await connectHub({ agent: 'security', mode: 'real', meta: { host: os.hostname(), lang, version: '0.1.0' }, log });
log(`connected to hub ${hub.url} (session ${hub.session_id})`);

// Local view of the audit stream (the hub is the source of truth and persists audit/<session>.jsonl itself).
const audit = new AuditLog({ file_path: path.resolve(process.cwd(), 'audit', `${hub.session_id}.green.jsonl`) });
const green = new SecurityAgent({ hub, audit, lang, pending_timeout_ms: Number(process.env.WASP_PERMISSION_TIMEOUT_MS ?? 0), log });
green.start();
log(`security online — ${green.engine.registry.list().length} tool policies, permissions ${Number(process.env.WASP_PERMISSION_TIMEOUT_MS ?? 0) > 0 ? `expire after ${process.env.WASP_PERMISSION_TIMEOUT_MS}ms` : 'never expire'}`);

hub.onAny((e) => {
  if (e.from === 'security' || e.type === 'context_updated') return;
  log(`<- ${e.type} from ${e.from}${e.to !== 'all' ? ` to ${e.to}` : ''}${e.type === 'agent_message' ? ` "${e.payload.message}"` : ''}`);
});
hub.on('hub_error', (e) => log(`HUB REJECTED: ${e.payload.message}`));

log('GREEN face: npm run security:ui  →  http://localhost:7004');

function shutdown() {
  log('shutting down');
  green.stop();
  hub.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
