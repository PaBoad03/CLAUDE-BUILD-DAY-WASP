/**
 * WASP HUB — the authoritative shared context and event backbone.
 *
 *   npm run hub
 *
 * WebSocket  ws://<host>:7331        every client sends/receives WaspEvent JSON
 * HTTP       GET  /health            liveness
 *            GET  /context           full SharedContext
 *            GET  /agents            presence
 *            GET  /events?limit=100  recent events
 *            POST /events            inject an event (curl/voice bridge). Body: partial WaspEvent {type, from, to?, payload}
 *
 * Behavior:
 *  - first message from a socket must be agent_registered (or agent_started)
 *  - every accepted event is reduced into context and broadcast to ALL clients (sender included)
 *  - after a state change the hub broadcasts context_updated
 *  - events from an unauthorized sender (see authority.ts) are rejected with hub_error + audit_event
 *  - on disconnect the hub emits agent_offline
 *  - audit_event payloads are also appended to ./audit/<session_id>.jsonl
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import {
  DEFAULT_HUB_PORT,
  isWaspEvent,
  newId,
  nowIso,
  type AgentId,
  type AgentRegistration,
  type AnyEvent,
  type EventPayloads,
  type EventType,
  type Participant,
  type SharedContext,
  type WaspEvent,
} from '@wasp/shared-types';
import { initialContext, reduce } from './reducer';
import { isAllowed } from './authority';

const PORT = Number(process.env.WASP_HUB_PORT ?? DEFAULT_HUB_PORT);
const MAX_EVENTS = 1000;

const session_id = newId('sess');
let context: SharedContext = initialContext(session_id, nowIso());
const recent: AnyEvent[] = [];
const clients = new Map<WebSocket, AgentRegistration | null>();

const auditDir = path.resolve(process.cwd(), 'audit');
fs.mkdirSync(auditDir, { recursive: true });
const auditFile = path.join(auditDir, `${session_id}.jsonl`);

const log = (...a: unknown[]) => console.log(`[hub ${new Date().toLocaleTimeString()}]`, ...a);

// ------------------------------------------------------------------ core

function hubEvent<T extends EventType>(type: T, payload: EventPayloads[T], to: Participant = 'all', correlation_id?: string): WaspEvent<T> {
  return { id: newId('evt'), type, session_id, from: 'hub', to, timestamp: nowIso(), payload, correlation_id };
}

function broadcast(evt: AnyEvent, except?: WebSocket) {
  const raw = JSON.stringify(evt);
  for (const [ws] of clients) {
    if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(raw);
  }
}

function sendTo(ws: WebSocket, evt: AnyEvent) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(evt));
}

/** Accept an event: reduce → record → broadcast → context_updated. */
function accept(evt: AnyEvent) {
  const { context: next, changed } = reduce(context, evt);
  context = next;
  recent.push(evt);
  if (recent.length > MAX_EVENTS) recent.splice(0, recent.length - MAX_EVENTS);
  broadcast(evt);
  if (changed.length) {
    broadcast(hubEvent('context_updated', { revision: context.revision, changed, context }));
  }
  if (evt.type === 'audit_event') {
    fs.appendFile(auditFile, JSON.stringify(evt.payload) + '\n', () => {});
  }
  const arrow = evt.to === 'all' ? '' : ` → ${evt.to}`;
  log(`${evt.from}${arrow}  ${evt.type}${evt.type === 'agent_message' ? `  "${evt.payload.message}"` : ''}`);
}

function reject(ws: WebSocket, evt: AnyEvent, reason: string) {
  log(`REJECTED ${evt.type} from ${evt.from}: ${reason}`);
  sendTo(ws, hubEvent('hub_error', { message: reason, original: evt }, evt.from, evt.correlation_id));
  accept(
    hubEvent('audit_event', {
      id: newId('aud'),
      timestamp: nowIso(),
      agent: 'hub',
      action: 'reject_event',
      reason,
      input: { type: evt.type, from: evt.from, to: evt.to },
      status: 'denied',
      approval_required: false,
      correlation_id: evt.id,
    }),
  );
}

function handleIncoming(ws: WebSocket, raw: string) {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    sendTo(ws, hubEvent('hub_error', { message: 'invalid JSON' }));
    return;
  }
  // Fill in what a lazy client may omit.
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    d.id ??= newId('evt');
    d.timestamp ??= nowIso();
    d.session_id = session_id;
    d.to ??= 'all';
  }
  if (!isWaspEvent(data)) {
    sendTo(ws, hubEvent('hub_error', { message: 'not a WaspEvent (need type/from/to/payload)', original: data }));
    return;
  }
  const evt = data;
  const reg = clients.get(ws);

  if (!reg) {
    if (evt.type !== 'agent_registered' && evt.type !== 'agent_started') {
      sendTo(ws, hubEvent('hub_error', { message: 'first message must be agent_registered' }));
      return;
    }
    const p = evt.payload;
    clients.set(ws, p);
    log(`agent connected: ${p.agent} (${p.mode})`);
    accept({ ...evt, type: 'agent_registered' } as AnyEvent);
    sendTo(ws, hubEvent('session_snapshot', { context, recent_events: recent.slice(-100) }, p.agent));
    return;
  }

  // A registered socket may only speak as itself (or as 'human' bridge if it registered as architect).
  const allowedFrom: Participant[] = reg.meta?.bridge === 'human' ? [reg.agent, 'human'] : [reg.agent];
  if (!allowedFrom.includes(evt.from)) {
    reject(ws, evt, `socket registered as "${reg.agent}" tried to send as "${evt.from}"`);
    return;
  }
  if (!isAllowed(evt.type, evt.from)) {
    reject(ws, evt, `"${evt.from}" is not allowed to emit "${evt.type}"`);
    return;
  }
  accept(evt);
}

function handleClose(ws: WebSocket) {
  const reg = clients.get(ws);
  clients.delete(ws);
  if (!reg) return;
  // Only mark offline if no other socket for the same agent remains.
  const stillConnected = [...clients.values()].some((r) => r?.agent === reg.agent);
  if (stillConnected) return;
  log(`agent disconnected: ${reg.agent}`);
  accept(hubEvent('agent_offline', { agent: reg.agent as AgentId, mode: reg.mode, reason: 'socket closed' }));
}

// ------------------------------------------------------------------ servers

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const json = (code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body, null, 2));
  };

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(200, { ok: true, session_id, revision: context.revision, clients: clients.size, port: PORT });
  }
  if (req.method === 'GET' && url.pathname === '/context') return json(200, context);
  if (req.method === 'GET' && url.pathname === '/agents') return json(200, context.agents);
  if (req.method === 'GET' && url.pathname === '/events') {
    const limit = Number(url.searchParams.get('limit') ?? 100);
    return json(200, recent.slice(-limit));
  }
  if (req.method === 'POST' && url.pathname === '/events') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const d = JSON.parse(body) as Record<string, unknown>;
        d.id ??= newId('evt');
        d.timestamp ??= nowIso();
        d.session_id = session_id;
        d.to ??= 'all';
        d.from ??= 'human';
        if (!isWaspEvent(d)) return json(400, { error: 'not a WaspEvent' });
        if (!isAllowed(d.type, d.from)) return json(403, { error: `"${d.from}" may not emit "${d.type}"` });
        accept(d);
        json(202, { accepted: d.id });
      } catch (e) {
        json(400, { error: (e as Error).message });
      }
    });
    return;
  }
  json(404, { error: 'not found', routes: ['/health', '/context', '/agents', '/events'] });
});

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  clients.set(ws, null);
  ws.on('message', (m) => handleIncoming(ws, m.toString()));
  ws.on('close', () => handleClose(ws));
  ws.on('error', () => handleClose(ws));
});

server.listen(PORT, '0.0.0.0', () => {
  accept(hubEvent('session_started', { session_id }));
  log(`WASP HUB listening on ws://0.0.0.0:${PORT}  (http://localhost:${PORT}/context)`);
  log(`session ${session_id} — audit → ${path.relative(process.cwd(), auditFile)}`);
});
