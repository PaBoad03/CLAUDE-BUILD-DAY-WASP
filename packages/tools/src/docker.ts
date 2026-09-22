import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const SANDBOX_IMAGE = 'wasp/sandbox:latest';
export const TARGET_IMAGE = 'nginx:alpine';
export const SANDBOX_NAME = 'wasp-sandbox';
export const TARGET_NAME = 'wasp-target';
export const LAB_NETWORK = 'wasp-lab';
export const EXTERNAL_NETWORK = 'bridge';

export interface ExecOutcome {
  exit_code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}

export interface DockerAvailability {
  available: boolean;
  version?: string;
  error?: string;
}

export type ContainerState = 'absent' | 'running' | 'stopped' | 'unknown';

/**
 * Everything the executor needs from Docker. Kept as an interface so the
 * agent and its tests can run against a fake without a daemon.
 */
export interface SandboxDriver {
  availability(): Promise<DockerAvailability>;
  containerState(name: string): Promise<ContainerState>;
  imageExists(tag: string): Promise<boolean>;
  buildSandboxImage(): Promise<ExecOutcome>;
  pullTargetImage(): Promise<ExecOutcome>;
  ensureLabNetwork(): Promise<void>;
  ensureTarget(): Promise<void>;
  createSandbox(): Promise<ExecOutcome>;
  destroySandbox(): Promise<ExecOutcome>;
  connectExternal(): Promise<ExecOutcome>;
  /** `docker exec` with a fixed argv. No shell, ever. */
  execInSandbox(argv: string[], timeoutMs?: number): Promise<ExecOutcome>;
  sandboxNetworks(): Promise<string[]>;
}

const DOCKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docker/sandbox');

function run(bin: string, argv: string[], timeoutMs = 15_000): Promise<ExecOutcome> {
  return new Promise((done) => {
    const child = execFile(
      bin,
      argv,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const timedOut = Boolean(err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed);
        const code = err && typeof (err as { code?: unknown }).code === 'number'
          ? ((err as { code: number }).code)
          : err ? null : 0;
        done({
          exit_code: err ? (typeof code === 'number' ? code : null) : 0,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? '') || (err && !stdout ? String(err.message) : ''),
          timed_out: timedOut,
        });
      },
    );
    child.on('error', () => { /* handled via callback err */ });
  });
}

/** Drives the local Docker CLI. Argv only — arguments are never joined into a shell string. */
export class DockerCliDriver implements SandboxDriver {
  constructor(private readonly bin = 'docker') {}

  async availability(): Promise<DockerAvailability> {
    const r = await run(this.bin, ['info', '--format', '{{.ServerVersion}}'], 8_000);
    if (r.exit_code === 0 && r.stdout.trim()) return { available: true, version: r.stdout.trim() };
    return { available: false, error: (r.stderr || r.stdout || 'docker not reachable').trim().split('\n')[0] };
  }

  async containerState(name: string): Promise<ContainerState> {
    const r = await run(this.bin, ['inspect', '--format', '{{.State.Status}}', name], 8_000);
    if (r.exit_code !== 0) return /No such/i.test(r.stderr) ? 'absent' : 'unknown';
    const s = r.stdout.trim();
    if (s === 'running') return 'running';
    if (['exited', 'created', 'paused', 'dead'].includes(s)) return 'stopped';
    return 'unknown';
  }

  async imageExists(tag: string): Promise<boolean> {
    const r = await run(this.bin, ['image', 'inspect', '--format', '{{.Id}}', tag], 8_000);
    return r.exit_code === 0;
  }

  buildSandboxImage(): Promise<ExecOutcome> {
    return run(this.bin, ['build', '-t', SANDBOX_IMAGE, DOCKER_DIR], 300_000);
  }

  pullTargetImage(): Promise<ExecOutcome> {
    return run(this.bin, ['pull', TARGET_IMAGE], 300_000);
  }

  async ensureLabNetwork(): Promise<void> {
    const probe = await run(this.bin, ['network', 'inspect', LAB_NETWORK, '--format', '{{.Name}}']);
    if (probe.exit_code === 0) return;
    // --internal: no route to the host's default network → no internet egress.
    const r = await run(this.bin, ['network', 'create', '--internal', LAB_NETWORK]);
    if (r.exit_code !== 0) throw new Error(`cannot create network ${LAB_NETWORK}: ${r.stderr.trim()}`);
  }

  async ensureTarget(): Promise<void> {
    const state = await this.containerState(TARGET_NAME);
    if (state === 'running') return;
    if (state === 'stopped') await run(this.bin, ['rm', '-f', TARGET_NAME]);
    const r = await run(this.bin, [
      'run', '-d', '--name', TARGET_NAME, '--network', LAB_NETWORK,
      '--memory', '64m', '--pids-limit', '64', '--restart', 'no',
      TARGET_IMAGE,
    ], 30_000);
    if (r.exit_code !== 0) throw new Error(`cannot start ${TARGET_NAME}: ${r.stderr.trim()}`);
  }

  async createSandbox(): Promise<ExecOutcome> {
    const state = await this.containerState(SANDBOX_NAME);
    if (state === 'running') return { exit_code: 0, stdout: 'already running', stderr: '', timed_out: false };
    if (state === 'stopped' || state === 'unknown') await run(this.bin, ['rm', '-f', SANDBOX_NAME]);
    return run(this.bin, [
      'run', '-d', '--name', SANDBOX_NAME,
      '--network', LAB_NETWORK,
      '--cap-drop', 'ALL', '--cap-add', 'NET_RAW',
      '--security-opt', 'no-new-privileges',
      '--memory', '256m', '--pids-limit', '128', '--cpus', '1',
      '--read-only', '--tmpfs', '/tmp',
      '--restart', 'no',
      SANDBOX_IMAGE,
    ], 30_000);
  }

  destroySandbox(): Promise<ExecOutcome> {
    return run(this.bin, ['rm', '-f', SANDBOX_NAME], 30_000);
  }

  connectExternal(): Promise<ExecOutcome> {
    return run(this.bin, ['network', 'connect', EXTERNAL_NETWORK, SANDBOX_NAME]);
  }

  execInSandbox(argv: string[], timeoutMs = 20_000): Promise<ExecOutcome> {
    return run(this.bin, ['exec', SANDBOX_NAME, ...argv], timeoutMs);
  }

  async sandboxNetworks(): Promise<string[]> {
    const r = await run(this.bin, [
      'inspect', '--format', '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}', SANDBOX_NAME,
    ]);
    return r.exit_code === 0 ? r.stdout.trim().split(/\s+/).filter(Boolean) : [];
  }
}
