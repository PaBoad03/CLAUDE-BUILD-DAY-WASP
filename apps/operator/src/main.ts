/**
 * ORANGE entrypoint. Connects to the WASP HUB (docs/CONTRACT.md) as `operator`.
 *
 *   npm run operator                      # real Docker. Set WASP_HUB_URL=ws://<pablo-ip>:7331 on Felipe's PC
 *   npm run operator -- --fake-docker     # no Docker: registers as a STUB, results can never validate the lab
 *   npm run operator -- --build           # pre-demo: build wasp/sandbox:latest + pull nginx:alpine, then exit
 *   npm run operator:ui                   # the ORANGE face on http://localhost:7003 (Vite + @wasp/ui)
 *
 * Solo testing on one PC:  npm run hub · npm run stubs -- researcher security · npm run operator -- --fake-docker · npm run architect
 */

import os from 'node:os';
import { connectHub } from '@wasp/event-bus';
import { DockerCliDriver, FakeDriver, ToolRegistry, labState, type SandboxDriver } from '@wasp/tools';
import { OperatorAgent } from './agent';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const log = (m: string) => console.log(`[orange ${new Date().toISOString().slice(11, 19)}] ${m}`);

const registry = ToolRegistry.load();
const fake = flag('--fake-docker');
const driver: SandboxDriver = fake ? new FakeDriver() : new DockerCliDriver();

if (flag('--build')) {
  const a = await driver.availability();
  if (!a.available) {
    console.error(`Docker unavailable: ${a.error}`);
    process.exit(1);
  }
  log('building wasp/sandbox:latest …');
  const b = await driver.buildSandboxImage();
  if (b.exit_code !== 0) {
    console.error(b.stderr);
    process.exit(1);
  }
  log('pulling nginx:alpine …');
  const p = await driver.pullTargetImage();
  if (p.exit_code !== 0) {
    console.error(p.stderr);
    process.exit(1);
  }
  log('ok — images ready, nothing will be pulled during the demo');
  process.exit(0);
}

const lab = await labState(driver);
log(fake ? 'FAKE Docker driver — registering as STUB, nothing real will run' : lab.docker_available ? `Docker ${lab.docker_version} available` : `Docker OFFLINE: ${lab.last_error}`);

const hub = await connectHub({
  agent: 'operator',
  mode: fake ? 'stub' : 'real',
  meta: { host: os.hostname(), docker: lab.docker_available, docker_version: lab.docker_version, fake, version: '0.1.0' },
  log,
});
log(`connected to hub ${hub.url} (session ${hub.session_id})`);

const agent = new OperatorAgent({ hub, registry, driver, stub: fake, log });
await agent.start();

hub.onAny((e) => {
  if (e.from === 'operator' || e.type === 'context_updated') return;
  log(`<- ${e.type} from ${e.from}${e.to !== 'all' ? ` to ${e.to}` : ''}${e.type === 'agent_message' ? ` "${e.payload.message}"` : ''}`);
});
hub.on('hub_error', (e) => log(`HUB REJECTED: ${e.payload.message}`));

log('ORANGE face: npm run operator:ui  →  http://localhost:7003');

function shutdown() {
  log('shutting down');
  agent.stop();
  hub.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
