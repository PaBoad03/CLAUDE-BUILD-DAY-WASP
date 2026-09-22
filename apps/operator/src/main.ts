import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import {
  DockerCliDriver, ToolRegistry, type PermissionDecision, type PermissionRequest, type SandboxDriver, type WaspEvent,
} from '@wasp/tools';
import { InMemoryBus, WebSocketBus, makeEvent, type Bus } from './bus.js';
import { OperatorAgent } from './agent.js';
import { ConsoleSpeaker, SayCommandSpeaker } from './voice.js';
import { startUiServer } from './ui-server.js';

/*
 * ORANGE entrypoint.
 *
 *   npm start -- --hub ws://<pablo-ip>:PORT      connect to the WASP HUB (normal mode)
 *   npm run demo                                  standalone: in-memory bus, terminal acts as GREEN+human
 *   npm run demo:fake                             same, without Docker (fake driver)
 *   npm run sandbox:build                         pre-demo: build image + pull target
 *
 * flags: --session <id>  --ui-port <n> (default 7003, 0 = off)  --tts say  --auto-approve  --keep
 */

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string, d?: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

async function main() {
  const registry = ToolRegistry.load();
  const driver: SandboxDriver = flag('--fake-docker')
    ? new (await import('../../../packages/tools/test/fake-driver.js')).FakeDriver()
    : new DockerCliDriver();

  if (flag('--build')) return build(driver);

  const session_id = opt('--session', `local-${randomUUID().slice(0, 8)}`)!;
  const hub = opt('--hub');
  const bus: Bus = hub
    ? new WebSocketBus(hub, (s) => console.log(`🟠 hub ${hub}: ${s}`))
    : new InMemoryBus();
  const speaker = opt('--tts') === 'say' ? new SayCommandSpeaker() : new ConsoleSpeaker();

  const uiPort = Number(opt('--ui-port', '7003'));
  const stopUi = uiPort > 0 ? startUiServer(bus, uiPort) : () => {};

  bus.subscribe((e) => console.log(`  ${e.type.padEnd(22)} ${e.from} → ${e.to}`));

  const agent = new OperatorAgent({
    session_id, bus, registry, driver, speaker,
    onFaceState: (s) => console.log(`🟠 FACE: ${s}`),
  });
  await agent.start();

  if (!hub) await runLocalDemo(bus, session_id, flag('--auto-approve'));

  const shutdown = async () => { await agent.stop(); stopUi(); await bus.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Local demo exits when done unless --keep: then the process (and the UI) stay up for inspection.
  if (!hub && !flag('--keep')) await shutdown();
  else if (!hub) console.log('🟠 demo finished; lab and UI left running (--keep). Ctrl+C to exit.');
}

async function build(driver: SandboxDriver) {
  const a = await driver.availability();
  if (!a.available) { console.error(`Docker unavailable: ${a.error}`); process.exit(1); }
  console.log('building wasp/sandbox:latest …');
  const b = await driver.buildSandboxImage();
  if (b.exit_code !== 0) { console.error(b.stderr); process.exit(1); }
  console.log('pulling nginx:alpine …');
  const p = await driver.pullTargetImage();
  if (p.exit_code !== 0) { console.error(p.stderr); process.exit(1); }
  console.log('ok — images ready, nothing will be pulled during the demo');
}

/**
 * Standalone demo. The terminal plays CYAN (sends requests) and GREEN+human
 * (answers permission_requested). This is a STUB for development only —
 * the real GREEN engine belongs to Juanda.
 */
async function runLocalDemo(bus: Bus, session_id: string, autoApprove: boolean) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((r) => rl.question(q, r));

  bus.subscribe((e: WaspEvent) => {
    if (e.type !== 'permission_requested') return;
    const p = e.payload as PermissionRequest;
    if (!p.requires_approval) return; // GREEN just audits LOW-risk
    void (async () => {
      console.log(`\n🟢 [stub GREEN] ${p.tool} — RISK ${p.risk} — HUMAN APPROVAL REQUIRED`);
      const answer = autoApprove ? 'yes' : (await ask('🟢 [stub GREEN] Authorize? (yes/no): ')).trim().toLowerCase();
      // Mirrors the rule in CONTEXT.md §11: only an explicit yes authorizes.
      const granted = answer === 'yes' || answer === 'sí' || answer === 'si';
      const decision: PermissionDecision = { request_id: p.request_id, granted, decided_by: 'human', user_authorization: answer, reason: granted ? undefined : 'human did not say yes' };
      await bus.publish(makeEvent(session_id, granted ? 'permission_granted' : 'permission_denied', 'security', 'operator', decision));
    })();
  });

  const request = (tool: string, args: Record<string, unknown>, reason: string) =>
    new Promise<void>((done) => {
      const request_id = randomUUID();
      const unsub = bus.subscribe((e) => {
        if (e.type === 'tool_finished' && (e.payload as { request_id: string }).request_id === request_id) { unsub(); done(); }
      });
      void bus.publish(makeEvent(session_id, 'validation_request', 'architect', 'operator', { request_id, tool, args, reason, requested_by: 'architect' }));
    });

  console.log('\n🩵 [stub CYAN] Operator, validate whether the connectivity exercise can run in our laboratory.\n');
  await request('sandbox_status', {}, 'check lab capability');
  await request('sandbox_create', {}, 'workshop lab validation');
  await request('sandbox_ping', { target: '127.0.0.1' }, 'loopback connectivity');
  await request('sandbox_dns', { name: 'wasp-target' }, 'internal DNS resolution');
  await request('sandbox_http', { url: 'http://wasp-target/' }, 'local HTTP target reachability');
  await request('sandbox_routes', {}, 'confirm isolation (no default route)');
  await request('sandbox_ping', { target: '8.8.8.8' }, 'ADVERSARIAL: off-list target must be rejected');
  if (!flag('--keep')) await request('sandbox_destroy', {}, 'demo cleanup (pass --keep to leave the lab running)');
  rl.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
