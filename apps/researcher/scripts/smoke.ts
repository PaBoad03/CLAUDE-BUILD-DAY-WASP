/**
 * End-to-end smoke test against PABLO'S REAL HUB:
 *   1. boots apps/hub on a test port,
 *   2. boots the MAGENTA agent pointed at it,
 *   3. connects as CYAN with the shared HubClient and does
 *      hub.request('research_request', …, { expect: 'research_result' }).
 * Exit code 0 = pass.
 *
 *   npm run smoke -w @wasp/researcher
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectHub } from "@wasp/event-bus";
import { newId } from "@wasp/shared-types";

const PORT = 7399;
const HUB_URL = `ws://127.0.0.1:${PORT}`;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const isWin = process.platform === "win32";
const npx = isWin ? "npx.cmd" : "npx";

const children: ChildProcess[] = [];
const fail = (msg: string) => {
  console.error(`SMOKE FAIL: ${msg}`);
  for (const c of children) c.kill();
  process.exit(1);
};
const timer = setTimeout(() => fail("timeout"), 60_000);

function boot(label: string, args: string[], cwd: string, env: Record<string, string>, readyMarker: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(npx, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], shell: isWin });
    children.push(child);
    let ready = false;
    child.stdout!.on("data", (d) => {
      process.stdout.write(`[${label}] ${d}`);
      if (!ready && String(d).includes(readyMarker)) {
        ready = true;
        resolve();
      }
    });
    child.stderr!.on("data", (d) => process.stderr.write(`[${label}!] ${d}`));
    child.on("exit", (code) => {
      if (!ready) fail(`${label} exited early (code ${code})`);
    });
  });
}

// 1. hub (Pablo's) — ready marker is whatever it logs on listen; fall back to a health poll.
const hubReady = boot("hub", ["tsx", "apps/hub/src/index.ts"], repoRoot, { WASP_HUB_PORT: String(PORT) }, "7399");
await Promise.race([hubReady, waitForHealth(`http://127.0.0.1:${PORT}/health`)]);

// 2. MAGENTA agent
await boot("magenta", ["tsx", "src/agent/main.ts"], path.resolve(here, ".."), { WASP_HUB_URL: HUB_URL, ANTHROPIC_API_KEY: "" }, "researcher online");

// 3. fake CYAN
const cyan = await connectHub({ agent: "architect", url: HUB_URL, reconnect: false, log: (m) => console.log(`[cyan] ${m}`) });
const seen: string[] = [];
cyan.onAny((e) => {
  if (e.from !== "researcher") return;
  const label = e.type === "agent_message" ? `${e.type}:${e.payload.intent}` : e.type;
  seen.push(label);
  console.log(`[cyan] <- ${label}${e.type === "agent_message" ? ` "${e.payload.message}"` : ""}`);
});

if (!cyan.isOnline("researcher")) fail("hub does not report researcher online");

const request_id = newId("req");
const res = await cyan.request(
  "research_request",
  { request_id, question: "beginner network reconnaissance workshop ping dns interfaces routes" },
  { to: "researcher", expect: "research_result", timeoutMs: 30_000 },
);

// give the trailing say()/audit a moment to arrive
await new Promise((r) => setTimeout(r, 400));

if (res.correlation_id !== request_id) fail(`correlation_id mismatch: ${res.correlation_id}`);
if (res.payload.request_id !== request_id) fail("payload.request_id mismatch");
if (res.payload.results.length === 0) fail("no results");
if (res.payload.counts.VERIFIED !== 0) fail("engine claimed VERIFIED without execution");
if (res.payload.stub) fail("result marked stub");
for (const must of ["agent_message:research_ack", "research_started", "research_result", "agent_message:research_complete", "audit_event"]) {
  if (!seen.includes(must)) fail(`missing ${must} (saw: ${seen.join(", ")})`);
}
const ctx = cyan.context!;
if (!ctx.research.some((r) => r.id === res.payload.results[0]!.id)) fail("hub context.research does not contain the result");
if (ctx.agent_states.researcher !== "COMPLETE") fail(`researcher face state is ${ctx.agent_states.researcher}, expected COMPLETE`);

clearTimeout(timer);
console.log(`SMOKE PASS — ${res.payload.results.length} results, mode ${(res.payload as { mode?: string }).mode}, context revision ${ctx.revision}`);
cyan.close();
for (const c of children) c.kill();
process.exit(0);

async function waitForHealth(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  fail("hub never became healthy");
}
