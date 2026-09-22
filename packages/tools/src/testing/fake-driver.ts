import type { ContainerState, DockerAvailability, ExecOutcome, SandboxDriver } from '../docker';

const ok = (stdout = ''): ExecOutcome => ({ exit_code: 0, stdout, stderr: '', timed_out: false });

/**
 * In-memory stand-in for Docker. Used by unit tests and by the operator's
 * `--fake-docker` mode so the whole event flow can be exercised on a machine
 * without a daemon. Output strings mimic the real tools closely enough for
 * the parsers to be tested. Anything produced through it is STUB data.
 */
export class FakeDriver implements SandboxDriver {
  dockerUp = true;
  sandbox: ContainerState = 'absent';
  target: ContainerState = 'absent';
  networks: string[] = [];
  execLog: string[][] = [];
  /** Override per-argv[0] output for failure-path tests. */
  responses: Record<string, ExecOutcome> = {};

  async availability(): Promise<DockerAvailability> {
    return this.dockerUp ? { available: true, version: 'fake-1.0' } : { available: false, error: 'Cannot connect to the Docker daemon (fake)' };
  }
  async containerState(name: string) {
    return name === 'wasp-sandbox' ? this.sandbox : this.target;
  }
  async imageExists() {
    return true;
  }
  async buildSandboxImage() {
    return ok('built');
  }
  async pullTargetImage() {
    return ok('pulled');
  }
  async ensureLabNetwork() {
    /* noop */
  }
  async ensureTarget() {
    this.target = 'running';
  }
  async createSandbox() {
    this.sandbox = 'running';
    this.networks = ['wasp-lab'];
    return ok('abc123');
  }
  async destroySandbox() {
    this.sandbox = 'absent';
    this.networks = [];
    return ok('wasp-sandbox');
  }
  async connectExternal() {
    this.networks.push('bridge');
    return ok();
  }
  async sandboxNetworks() {
    return this.networks;
  }

  async execInSandbox(argv: string[]): Promise<ExecOutcome> {
    this.execLog.push(argv);
    if (this.responses[argv[0]]) return this.responses[argv[0]];
    switch (argv[0]) {
      case 'ping': {
        const n = Number(argv[2]);
        return ok(`PING ${argv.at(-1)} (127.0.0.1) 56(84) bytes of data.\n\n--- ping statistics ---\n${n} packets transmitted, ${n} received, 0% packet loss, time 3005ms\n`);
      }
      case 'nslookup':
        return ok(`Server:\t\t127.0.0.11\nAddress:\t127.0.0.11#53\n\nNon-authoritative answer:\nName:\t${argv[1]}\nAddress: 172.18.0.2\n`);
      case 'ip':
        return argv[1] === 'route'
          ? ok('172.18.0.0/16 dev eth0 scope link  src 172.18.0.3\n')
          : ok('1: lo    inet 127.0.0.1/8 scope host lo\n2: eth0    inet 172.18.0.3/16 brd 172.18.255.255 scope global eth0\n');
      case 'curl':
        return ok('200 0.004512');
      case 'nc':
        return { exit_code: 0, stdout: '', stderr: 'Connection to wasp-target 80 port [tcp/http] succeeded!\n', timed_out: false };
      default:
        return { exit_code: 127, stdout: '', stderr: `fake: unknown command ${argv[0]}`, timed_out: false };
    }
  }
}
