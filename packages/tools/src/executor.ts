import type { SandboxState, ToolResult } from '@wasp/shared-types';
import { ToolRegistry } from './registry';
import { EXTERNAL_NETWORK, LAB_NETWORK, SANDBOX_IMAGE, SANDBOX_NAME, TARGET_NAME, type ExecOutcome, type SandboxDriver } from './docker';

type Args = Record<string, string | number>;

/**
 * success      ran, and the test passed
 * failure      ran, and the test failed (e.g. 100% packet loss)
 * error        could not run to completion (timeout, docker error)
 * unavailable  capability missing (Docker offline, sandbox not created)
 * rejected     never reached execution: unknown tool / bad args
 */
export type ExecutionStatus = 'success' | 'failure' | 'error' | 'unavailable' | 'rejected';

/** Rich, ORANGE-internal result of one execution. Mapped to the shared `ToolResult` by toToolResult(). */
export interface ExecutionResult {
  request_id: string;
  tool: string;
  args: Record<string, unknown>;
  status: ExecutionStatus;
  started_at: string;
  finished_at: string;
  /** Exact argv executed, or [] when nothing ran. Never fabricated. */
  command: string[];
  exit_code: number | null;
  stdout: string;
  stderr: string;
  /** One line suitable for TTS and the RESULT window. */
  summary: string;
  /** Parsed, tool-specific facts (packet loss, http code, ...). */
  data: Record<string, unknown>;
}

/** What the lab looks like right now, as seen through the driver. */
export interface LabState {
  docker_available: boolean;
  docker_version?: string;
  container: 'absent' | 'running' | 'stopped' | 'unknown';
  network: 'none' | 'internal' | 'external';
  target_available: boolean;
  last_error?: string;
  updated_at: string;
}

interface Runner {
  /** Whether this tool needs a running sandbox container. */
  needsSandbox: boolean;
  argv?: (a: Args) => string[];
  run: (a: Args, ctx: RunCtx) => Promise<Partial<ExecutionResult> & { status: ExecutionStatus; summary: string }>;
}

interface RunCtx {
  driver: SandboxDriver;
  argv: string[];
}

const pct = (n: number) => `${n}%`;

/**
 * Maps registry tool names to fixed argv templates and result parsers.
 * The argv is built from *validated* args only. There is no generic
 * "run command" tool and there never will be.
 */
const RUNNERS: Record<string, Runner> = {
  sandbox_status: {
    needsSandbox: false,
    run: async (_a, { driver }) => {
      const state = await labState(driver);
      const status: ExecutionStatus = state.docker_available ? 'success' : 'unavailable';
      const summary = state.docker_available
        ? `Docker ${state.docker_version} available. Sandbox ${state.container}, network ${state.network}, target ${state.target_available ? 'up' : 'down'}.`
        : `Docker capability is unavailable: ${state.last_error ?? 'unknown error'}.`;
      return { status, summary, data: { ...state } };
    },
  },

  docker_sandbox: {
    needsSandbox: false,
    run: async (_a, { driver }) => {
      const avail = await driver.availability();
      if (!avail.available) {
        return { status: 'unavailable', summary: `Docker capability is unavailable: ${avail.error}. Cannot create sandbox.`, data: { docker: avail } };
      }
      await driver.ensureLabNetwork();
      let targetUp = true;
      try {
        await driver.ensureTarget();
      } catch {
        targetUp = false;
      }
      const r = await driver.createSandbox();
      const ok = r.exit_code === 0;
      // nginx needs a moment on first start; wait (bounded) so the first HTTP test is fair.
      let targetReady = false;
      if (ok && targetUp) {
        for (let i = 0; i < 20 && !targetReady; i++) {
          const probe = await driver.execInSandbox(['nc', '-z', '-w', '1', TARGET_NAME, '80'], 3_000);
          targetReady = probe.exit_code === 0;
          if (!targetReady) await new Promise((res) => setTimeout(res, 500));
        }
      }
      return {
        status: ok ? 'success' : 'error',
        summary: ok
          ? `Sandbox ${SANDBOX_NAME} online on isolated network ${LAB_NETWORK}${targetUp ? (targetReady ? '' : ' (warning: local target not answering yet)') : ' (warning: local target failed to start)'}.`
          : `Sandbox failed to start: ${firstLine(r.stderr)}`,
        ...outcome(r),
        data: { container: SANDBOX_NAME, network: LAB_NETWORK, target_available: targetUp, target_ready: targetReady, image_missing: /No such image|Unable to find image/i.test(r.stderr) },
      };
    },
  },

  sandbox_destroy: {
    needsSandbox: false,
    run: async (_a, { driver }) => {
      const r = await driver.destroySandbox();
      return { status: r.exit_code === 0 ? 'success' : 'error', summary: r.exit_code === 0 ? 'Sandbox removed.' : `Failed to remove sandbox: ${firstLine(r.stderr)}`, ...outcome(r) };
    },
  },

  sandbox_ping: {
    needsSandbox: true,
    argv: (a) => ['ping', '-c', String(a.count ?? 4), '-W', '2', String(a.target)],
    run: async (a, { driver, argv }) => {
      const r = await driver.execInSandbox(argv);
      const m = /(\d+) packets transmitted, (\d+) (?:packets )?received.*?(\d+(?:\.\d+)?)% packet loss/s.exec(r.stdout);
      const sent = m ? Number(m[1]) : null;
      const recv = m ? Number(m[2]) : null;
      const loss = m ? Number(m[3]) : null;
      const pass = r.exit_code === 0 && loss !== null && loss < 100;
      return {
        status: r.timed_out ? 'error' : pass ? 'success' : 'failure',
        summary: m ? `Ping ${a.target}: ${sent} sent, ${recv} received, ${pct(loss!)} loss. ${pass ? 'PASS' : 'FAIL'}.` : `Ping ${a.target} produced no parseable output. ${firstLine(r.stderr)}`,
        ...outcome(r),
        data: { target: a.target, packets_sent: sent, packets_received: recv, loss_pct: loss, pass },
      };
    },
  },

  sandbox_dns: {
    needsSandbox: true,
    argv: (a) => ['nslookup', String(a.name)],
    run: async (a, { driver, argv }) => {
      const r = await driver.execInSandbox(argv);
      // Whole-line match: skips the "Address: 127.0.0.11#53" server line.
      const addrs = [...r.stdout.matchAll(/^Address:\s*(\d+\.\d+\.\d+\.\d+)\s*$/gm)].map((x) => x[1]);
      const pass = r.exit_code === 0 && addrs.length > 0;
      return {
        status: pass ? 'success' : r.timed_out ? 'error' : 'failure',
        summary: pass ? `DNS ${a.name} → ${addrs.join(', ')}. PASS.` : `DNS ${a.name} did not resolve. FAIL.`,
        ...outcome(r),
        data: { name: a.name, addresses: addrs, pass },
      };
    },
  },

  sandbox_interfaces: {
    needsSandbox: true,
    argv: () => ['ip', '-o', 'addr', 'show'],
    run: async (_a, { driver, argv }) => {
      const r = await driver.execInSandbox(argv);
      const ifaces = r.stdout
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const m = /^\d+:\s+(\S+)\s+inet6?\s+(\S+)/.exec(l);
          return m ? { name: m[1], address: m[2] } : null;
        })
        .filter(Boolean);
      return { status: r.exit_code === 0 ? 'success' : 'error', summary: `${ifaces.length} interface addresses found.`, ...outcome(r), data: { interfaces: ifaces } };
    },
  },

  sandbox_routes: {
    needsSandbox: true,
    argv: () => ['ip', 'route', 'show'],
    run: async (_a, { driver, argv }) => {
      const r = await driver.execInSandbox(argv);
      const routes = r.stdout.split('\n').filter(Boolean);
      const hasDefault = routes.some((l) => l.startsWith('default'));
      return {
        status: r.exit_code === 0 ? 'success' : 'error',
        summary: `${routes.length} routes. ${hasDefault ? 'Default route present (egress possible).' : 'No default route: sandbox is isolated.'}`,
        ...outcome(r),
        data: { routes, has_default_route: hasDefault },
      };
    },
  },

  sandbox_http: {
    needsSandbox: true,
    argv: (a) => ['curl', '-sS', '-o', '/dev/null', '-w', '%{http_code} %{time_total}', '--max-time', '5', '--retry', '3', '--retry-delay', '1', '--retry-connrefused', String(a.url)],
    run: async (a, { driver, argv }) => {
      const r = await driver.execInSandbox(argv);
      const m = /^(\d{3}) ([\d.]+)/.exec(r.stdout.trim());
      const code = m ? Number(m[1]) : null;
      const pass = r.exit_code === 0 && code !== null && code >= 200 && code < 400;
      return {
        status: pass ? 'success' : r.timed_out ? 'error' : 'failure',
        summary: pass ? `HTTP GET ${a.url} → ${code} in ${m![2]}s. PASS.` : `HTTP GET ${a.url} failed${code ? ` (${code})` : ''}. ${firstLine(r.stderr)}`.trim(),
        ...outcome(r),
        data: { url: a.url, http_code: code, seconds: m ? Number(m[2]) : null, pass },
      };
    },
  },

  sandbox_port_check: {
    needsSandbox: true,
    argv: (a) => ['nc', '-z', '-v', '-w', '2', String(a.host), String(a.port)],
    run: async (a, { driver, argv }) => {
      const r = await driver.execInSandbox(argv);
      const open = r.exit_code === 0;
      return {
        status: r.timed_out ? 'error' : open ? 'success' : 'failure',
        summary: `TCP ${a.host}:${a.port} is ${open ? 'OPEN' : 'CLOSED'}.`,
        ...outcome(r),
        data: { host: a.host, port: a.port, open },
      };
    },
  },

  sandbox_network_external: {
    needsSandbox: true,
    run: async (_a, { driver }) => {
      const r = await driver.connectExternal();
      const ok = r.exit_code === 0 || /already exists/i.test(r.stderr);
      return {
        status: ok ? 'success' : 'error',
        summary: ok ? `Sandbox attached to ${EXTERNAL_NETWORK}. Internet egress is now possible.` : `Could not attach external network: ${firstLine(r.stderr)}`,
        ...outcome(r),
        data: { network: EXTERNAL_NETWORK },
      };
    },
  },
};

function outcome(r: ExecOutcome) {
  return { exit_code: r.exit_code, stdout: r.stdout, stderr: r.stderr };
}

function firstLine(s: string): string {
  return (s || '').trim().split('\n')[0] ?? '';
}

export async function labState(driver: SandboxDriver): Promise<LabState> {
  const now = new Date().toISOString();
  const avail = await driver.availability();
  if (!avail.available) {
    return { docker_available: false, container: 'unknown', network: 'none', target_available: false, last_error: avail.error, updated_at: now };
  }
  const [container, target, nets] = await Promise.all([driver.containerState(SANDBOX_NAME), driver.containerState(TARGET_NAME), driver.sandboxNetworks()]);
  const network = container !== 'running' || nets.length === 0 ? 'none' : nets.includes(EXTERNAL_NETWORK) ? 'external' : 'internal';
  return { docker_available: true, docker_version: avail.version, container, network, target_available: target === 'running', updated_at: now };
}

/** LabState → the shared-contract SandboxState (what goes on the bus / in SharedContext.sandbox). */
export function toSandboxState(lab: LabState, last_test?: ToolResult): SandboxState {
  if (!lab.docker_available) {
    return { available: false, status: 'OFFLINE', network: 'NONE', message: `Docker capability is unavailable: ${lab.last_error ?? 'unknown error'}`, last_test };
  }
  const status: SandboxState['status'] = lab.container === 'running' ? 'RUNNING' : lab.container === 'unknown' ? 'ERROR' : 'STOPPED';
  return {
    available: true,
    status,
    image: SANDBOX_IMAGE,
    container_id: lab.container === 'absent' ? undefined : SANDBOX_NAME,
    network: lab.network === 'internal' ? 'CONTROLLED' : lab.network === 'external' ? 'EXTERNAL' : 'NONE',
    docker_version: lab.docker_version,
    target_available: lab.target_available,
    message: lab.container === 'running' ? `Docker ${lab.docker_version}, ${lab.network === 'internal' ? 'isolated lab network (no egress)' : lab.network === 'external' ? 'EXTERNAL network attached' : 'no network'}` : `Docker ${lab.docker_version}, sandbox ${lab.container}`,
    last_test,
  };
}

/** ExecutionResult → the shared-contract ToolResult (emitted as tool_finished / sandbox_result). */
export function toToolResult(r: ExecutionResult, extra: { permission_id?: string; stub?: boolean } = {}): ToolResult {
  const status: ToolResult['status'] = r.status === 'error' ? 'failure' : r.status;
  return {
    tool_id: r.tool,
    request_id: r.request_id,
    status,
    output: { stdout: r.stdout, stderr: r.stderr, data: r.data },
    error: r.status === 'success' ? undefined : r.summary,
    summary: r.summary,
    command: r.command,
    exit_code: r.exit_code,
    input: r.args,
    permission_id: extra.permission_id,
    started_at: r.started_at,
    finished_at: r.finished_at,
    duration_ms: Math.max(0, Date.parse(r.finished_at) - Date.parse(r.started_at)),
    stub: extra.stub || undefined,
  };
}

export interface ExecuteInput {
  request_id: string;
  tool: string;
  args: Record<string, unknown>;
}

/**
 * The safe execution layer. Validates against the registry, refuses anything
 * off-list, checks Docker + sandbox presence, then runs a fixed argv.
 * It does NOT check authorization — that is the agent's job, before calling this.
 */
export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly driver: SandboxDriver,
  ) {}

  async execute(input: ExecuteInput): Promise<ExecutionResult> {
    const started_at = new Date().toISOString();
    const base = { request_id: input.request_id, tool: input.tool, args: input.args ?? {}, started_at, command: [] as string[], exit_code: null, stdout: '', stderr: '', data: {} as Record<string, unknown> };
    const finish = (p: Partial<ExecutionResult> & { status: ExecutionStatus; summary: string }): ExecutionResult => ({ ...base, ...p, finished_at: new Date().toISOString() }) as ExecutionResult;

    const v = this.registry.validate(input.tool, input.args ?? {});
    if (!v.ok) return finish({ status: 'rejected', summary: `Rejected: ${v.errors.join('; ')}`, data: { errors: v.errors } });

    const runner = RUNNERS[input.tool];
    if (!runner) return finish({ status: 'rejected', summary: `Rejected: tool "${input.tool}" is declared but has no executor.` });

    const argv = runner.argv ? runner.argv(v.args) : [];
    base.args = v.args;
    base.command = argv;

    if (runner.needsSandbox) {
      const avail = await this.driver.availability();
      if (!avail.available) return finish({ status: 'unavailable', summary: `Docker capability is unavailable: ${avail.error}. Cannot run ${input.tool}.`, data: { docker: avail } });
      const state = await this.driver.containerState(SANDBOX_NAME);
      if (state !== 'running') return finish({ status: 'unavailable', summary: `Sandbox is ${state}. Run docker_sandbox first.`, data: { container: state } });
    }

    try {
      const out = await runner.run(v.args, { driver: this.driver, argv });
      return finish(out);
    } catch (e) {
      return finish({ status: 'error', summary: `Execution error: ${(e as Error).message}`, stderr: String((e as Error).stack ?? e) });
    }
  }
}
