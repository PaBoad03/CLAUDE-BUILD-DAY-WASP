/**
 * CYAN — Architect / Orchestrator (CLI entrypoint).
 *
 *   npm run architect -- "WASP, create a two-hour beginner network reconnaissance workshop."   # one run, then exit
 *   npm run architect                 # no request: WASP listens, runs, and listens again (demo mode)
 *   npm run architect:ui              # the CYAN face on http://localhost:5173 (Chrome/Edge for the mic)
 *
 * With Claude credentials (ANTHROPIC_API_KEY or `ant auth login`) Claude drives the orchestration
 * through structured tool calls (./orchestrator.ts). Without them — or with --deterministic /
 * WASP_ARCHITECT_MODE=deterministic — the fixed reference flow runs (./deterministic.ts) and says so.
 *
 * Env: WASP_HUB_URL, WASP_CLAUDE_MODEL (default claude-opus-5), WASP_CLAUDE_EFFORT (low|medium|high|xhigh|max, default medium),
 *      WASP_AUTO_ANSWER=yes|no|stop|maybe (non-interactive permission answers), WASP_AUTO_REQUEST=... (non-interactive request),
 *      WASP_ARCHITECT_MODE=claude|deterministic
 */

import Anthropic from '@anthropic-ai/sdk';
import { connectHub } from '@wasp/event-bus';
import type { HumanDecision } from '@wasp/shared-types';
import { CliHuman } from './human';
import { deterministicFlow } from './deterministic';
import { ClaudeOrchestrator, DEFAULT_MODEL, hasClaudeCredentials, type Effort } from './orchestrator';

const argv = process.argv.slice(2);
const deterministicFlag = argv.includes('--deterministic');
const argRequest = argv.filter((a) => !a.startsWith('--')).join(' ');
const log = (m: string) => console.log(`[cyan ${new Date().toISOString().slice(11, 19)}] ${m}`);

const hub = await connectHub({ agent: 'architect', mode: 'real', meta: { host: 'pablo', engine: 'pending' }, log });
const human = new CliHuman({ hub, autoAnswer: process.env.WASP_AUTO_ANSWER, log });

hub.onAny((e) => {
  if (e.type === 'agent_message' && e.from !== 'architect') console.log(`  ${e.from.toUpperCase()} → ${String(e.to).toUpperCase()}: ${e.payload.message}`);
  if (e.type === 'hub_error') console.error(`  HUB ERROR: ${e.payload.message}`);
});

// Human authorization: when GREEN says a human is needed, CYAN asks and forwards the RAW answer.
// GREEN interprets the words; `decision` here is only a hint (trusted by GREEN for channel 'ui' only).
hub.onMine('permission_required', async (evt) => {
  const p = evt.payload;
  hub.setState('WAITING_FOR_PERMISSION', p.operation);
  hub.say('human', p.human_prompt, 'ask_human');
  hub.emit('speak_requested', { agent: 'architect', text: p.human_prompt, priority: 'high' });
  const raw = await human.ask(p.human_prompt);
  const decision: HumanDecision = /^(y|yes|sí|si|dale)\b/i.test(raw) ? 'YES' : /^(n|no)\b/i.test(raw) ? 'NO' : /^(stop|cancel|para|alto)\b/i.test(raw) ? 'STOP' : 'AMBIGUOUS';
  hub.emit('user_authorization', { permission_id: p.permission_id, decision, raw, channel: 'cli' }, { to: 'security', correlation_id: p.permission_id });
});
hub.onMine('permission_clarification_needed', async (evt) => {
  const raw = await human.ask(evt.payload.human_prompt);
  hub.emit('user_authorization', { permission_id: evt.payload.permission_id, decision: 'AMBIGUOUS', raw, channel: 'cli' }, { to: 'security', correlation_id: evt.payload.permission_id });
});

// ------------------------------------------------------------------ one orchestration

const useClaude = !deterministicFlag && process.env.WASP_ARCHITECT_MODE !== 'deterministic' && hasClaudeCredentials();
const model = process.env.WASP_CLAUDE_MODEL || DEFAULT_MODEL;
const effort = (process.env.WASP_CLAUDE_EFFORT as Effort | undefined) || 'medium';
const online = (a: 'researcher' | 'operator' | 'security') => (hub.isOnline(a) ? (hub.isStub(a) ? 'stub' : 'online') : 'OFFLINE');

async function runOnce(request: string): Promise<void> {
  log(`request: ${request}`);
  log(`agents: researcher=${online('researcher')} operator=${online('operator')} security=${online('security')}`);
  hub.emit('user_message', { text: request, channel: 'cli' }, { to: 'architect' });

  let final: string;
  try {
    if (useClaude) {
      log(`engine: Claude (${model}, effort ${effort})`);
      hub.emit('decision_made', { decision: `Orquestando con Claude (${model}).`, rationale: 'Claude decide los pasos; la aplicación los ejecuta a través del hub y es dueña de la autorización y del estado de validación.' });
      const result = await new ClaudeOrchestrator({ hub, human, client: new Anthropic(), model, effort, log }).run(request);
      final = result.final;
      log(`done (${result.reason}) in ${result.iterations} steps — tokens in ${result.usage.input_tokens} (cached ${result.usage.cache_read_input_tokens}) / out ${result.usage.output_tokens}`);
    } else {
      const why = deterministicFlag || process.env.WASP_ARCHITECT_MODE === 'deterministic' ? 'requested' : 'no Claude API credentials (set ANTHROPIC_API_KEY in .env)';
      log(`engine: deterministic flow (${why})`);
      hub.emit('warning', { message: `CYAN sin Claude: ${why}. La orquestación es un guion fijo.` });
      final = await deterministicFlow(hub, request, log);
    }
  } catch (err) {
    // Never die silently: the face would just show "architect offline".
    final = `Algo falló en la orquestación: ${(err as Error).message}`;
    log(`ERROR ${(err as Error).stack ?? (err as Error).message}`);
    hub.emit('error', { message: final });
    hub.say('human', final, 'error');
    hub.setState('ERROR', 'orchestration failed');
  }
  console.log(`\n=== WASP ===\n${final}\n`);
  console.log(`context revision ${hub.context?.revision}, state ${hub.context?.current_state}, audit entries ${hub.context?.audit.length}`);
}

// ------------------------------------------------------------------ go

if (argRequest || process.env.WASP_AUTO_REQUEST) {
  await runOnce(argRequest || process.env.WASP_AUTO_REQUEST!);
  human.close();
  setTimeout(() => {
    hub.close();
    process.exit(0);
  }, 500);
} else {
  // Demo mode: listen → run → listen again, until Ctrl+C. The CYAN face (SEND) or stdin provide the request.
  for (;;) {
    hub.setState('LISTENING', 'esperando al humano');
    hub.emit('session_state', { state: 'IDLE' });
    const request = (await human.ask('WASP escucha. ¿Qué necesitas?', null)).trim();
    if (!request) continue;
    await runOnce(request);
    log('listo — escuchando la siguiente petición (Ctrl+C para salir)');
  }
}
