/**
 * GREEN standalone demo — runs the full permission flow in the terminal with
 * the local bus. No hub, no Claude, no Docker needed. Use it to show the
 * security layer working before the hub is wired.
 *
 *   npm run demo -w @wasp/app-security
 *   npm run demo -w @wasp/app-security -- --answer "tal vez"
 *   npm run demo -w @wasp/app-security -- --docker-offline
 */
import type { AgentMessagePayload, ToolRequest, TypedEvent, WaspEvent } from '@wasp/shared-types';
import { newId, nowIso } from '@wasp/shared-types';
import { LocalEventBus, SecurityAgent } from '@wasp/permissions';
import { canMarkValidated } from '@wasp/audit';

const args = process.argv.slice(2);
const answer = argValue('--answer') ?? 'sí';
const dockerOffline = args.includes('--docker-offline');
const SESSION = newId('sess');

const bus = new LocalEventBus();
const green = new SecurityAgent({ bus, settle_ms: 0 });

const G = '\x1b[92m', O = '\x1b[93m', C = '\x1b[96m', W = '\x1b[97m', D = '\x1b[90m', R = '\x1b[0m';

bus.subscribe('agent_message', (e) => {
  const p = (e as TypedEvent<'agent_message'>).payload;
  const color = p.from === 'security' ? G : p.from === 'operator' ? O : C;
  console.log(`${color}${p.from.toUpperCase()} → ${p.to.toUpperCase()}${R}: "${p.message}"`);
});
bus.subscribe('agent_state_changed', (e) => {
  const p = (e as TypedEvent<'agent_state_changed'>).payload;
  if (p.agent === 'security') console.log(`${D}   [GREEN FACE] ${p.state}${p.detail ? ' — ' + p.detail : ''}${R}`);
});
bus.subscribe('tool_blocked', (e) => console.log(`${G}   ⛔ tool_blocked: ${(e as TypedEvent<'tool_blocked'>).payload.reason}${R}`));
bus.subscribe('warning', (e) => console.log(`${G}   ⚠ warning: ${(e as TypedEvent<'warning'>).payload.message}${R}`));

green.start();
publish('session_started', {}, 'system');

console.log(`${W}HUMAN${R}: "WASP, crea y valida un workshop de reconocimiento de red para principiantes."`);
publish('user_message', { text: 'WASP, crea y valida un workshop de reconocimiento de red para principiantes.', channel: 'voice' }, 'human');

say('architect', 'operator', 'Operator, ¿puedes validar el laboratorio en el sandbox?');

if (dockerOffline) {
  const check = req('docker_status', 'docker_status', {}, 'check whether Docker is available');
  publish('tool_requested', check, 'operator');
  publish('tool_started', { request_id: check.request_id, tool: check.tool, operation: check.operation, input: {} }, 'operator');
  publish('tool_finished', { request_id: check.request_id, tool: check.tool, operation: check.operation, status: 'unavailable', output: { docker: 'OFFLINE' }, error: 'docker daemon is not running' }, 'operator');
  say('operator', 'architect', 'Docker no está disponible. No puedo validar el laboratorio.');
  finish();
} else {
  say('operator', 'security', 'Security, necesito autorización para crear el sandbox con red controlada.');
  const sandbox = req('docker_sandbox', 'create_sandbox', { image: 'debian:stable-slim', network_access: 'controlled' }, 'validate the workshop lab');
  publish('tool_requested', sandbox, 'operator');

  const pending = green.engine.pending(SESSION)[0];
  if (!pending) throw new Error('expected a pending permission');
  console.log(`${C}CYAN → HUMAN${R}: "${pending.prompt_for_human}"`);
  console.log(`${W}HUMAN${R}: "${answer}"`);
  publish('user_message', { text: answer, channel: 'voice' }, 'human');

  if (green.engine.isAuthorized(sandbox.request_id)) {
    say('operator', 'all', 'Autorización recibida. Iniciando sandbox.');
    publish('tool_started', { request_id: sandbox.request_id, permission_id: pending.permission_id, tool: sandbox.tool, operation: sandbox.operation, input: sandbox.input }, 'operator');
    publish('tool_finished', { request_id: sandbox.request_id, permission_id: pending.permission_id, tool: sandbox.tool, operation: sandbox.operation, status: 'success', output: { container: 'wasp-lab', status: 'RUNNING' } }, 'operator');
    const ping = req('sandbox_ping', 'ping 127.0.0.1', { target: '127.0.0.1', count: 4 }, 'connectivity test');
    publish('tool_requested', ping, 'operator');
    publish('tool_started', { request_id: ping.request_id, tool: ping.tool, operation: ping.operation, input: ping.input }, 'operator');
    publish('sandbox_result', { request_id: ping.request_id, tool: 'sandbox_ping', test: 'ping 127.0.0.1', status: 'success', output: { packets: 4, received: 4, loss: '0%' } }, 'operator');
    say('operator', 'architect', 'Prueba de conectividad superada. 0% de pérdida.');
  } else {
    say('operator', 'architect', 'Sin autorización. El sandbox no se creará.');
  }
  finish();
}

function finish(): void {
  const audit = green.audit.list({ session_id: SESSION });
  const validated = canMarkValidated(audit, SESSION);
  console.log('');
  console.log(`${G}══ GREEN / AUDIT (${audit.length} entries) ══${R}`);
  for (const a of audit) {
    console.log(`${D}${a.timestamp}${R} ${a.agent.padEnd(9)} ${a.status.padEnd(16)} ${a.tool.padEnd(16)} ${a.action}${a.user_authorization ? `  [human: "${a.user_authorization}"]` : ''}`);
  }
  console.log('');
  console.log(`${G}lab.validated may be set to: ${validated ? 'TRUE (evidence present)' : 'FALSE (no successful sandbox evidence)'}${R}`);
  console.log(`${D}GREEN face state: ${green.getState()}${R}`);
  green.stop();
}

// ---- helpers
function publish(type: WaspEvent['type'], payload: unknown, source: WaspEvent['source']): void {
  bus.publish({ event_id: newId('evt'), type, session_id: SESSION, source, timestamp: nowIso(), payload });
}
function say(from: AgentMessagePayload['from'], to: AgentMessagePayload['to'], message: string): void {
  publish('agent_message', { from, to, message, speak: true } satisfies AgentMessagePayload, from);
}
function req(tool: string, operation: string, input: Record<string, unknown>, reason: string): ToolRequest {
  return { request_id: newId('req'), session_id: SESSION, agent: 'operator', tool, operation, input, reason, timestamp: nowIso() };
}
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
