# 🟠 ORANGE — Operator / Sandbox (owner: Felipe)

The ORANGE agent turns approved requests into real, allowlisted execution
inside a Docker sandbox, and reports exactly what happened. It never
authorizes itself. It speaks to the rest of WASP only through `@wasp/event-bus`
(docs/CONTRACT.md).

```
CYAN   ─ validation_request / tool_requested (to: operator) ─▶ ORANGE
ORANGE ─ permission_requested (to: security) ─▶ GREEN                       (always, even LOW risk)
GREEN  ─ permission_granted | permission_denied | permission_cancelled ─▶  (waited for only if requires_approval)
ORANGE ─ tool_started → [docker exec fixed argv] → sandbox_test, sandbox_result, tool_finished, sandbox_state, audit_event
ORANGE ─ validation_result (to: architect)   validated: true ONLY if every real test succeeded
```

## Run

```bash
npm install                                   # at the repo root, once
npm run operator -- --build                   # once, before the demo: builds wasp/sandbox:latest, pulls nginx:alpine
WASP_HUB_URL=ws://<pablo-ip>:7331 npm run operator      # normal mode (Felipe's PC)
npm run operator -- --fake-docker             # no Docker: registers as STUB, results can never validate the lab
npm test -w @wasp/operator                    # agent tests (FakeHub + FakeDriver); packages/tools has the executor tests
```

ORANGE face (DOCKER / TERMINAL / RESULT windows): http://localhost:7003 — the page connects
to the hub itself as `operator` with `meta.role = 'ui'`. `--ui-port 0` disables it.

Solo rehearsal on one PC:
`npm run hub` · `npm run stubs -- researcher security` · `npm run operator -- --fake-docker` · `npm run architect`

## Layout

| path | what |
|---|---|
| `schemas/tools.json` | **tool registry**: id, risk, requires_approval, arg allowlists. Single source of truth; emitted as `tools_registered` so GREEN reads the same data |
| `packages/tools/src/registry.ts` | loads/validates the registry; rejects unknown tools, unknown args, off-list values, shell chars; exports `ToolDefinition[]` |
| `packages/tools/src/docker.ts` | `SandboxDriver` interface + `DockerCliDriver` (argv-only, no shell) |
| `packages/tools/src/executor.ts` | tool → fixed argv, parses results, maps to the shared `ToolResult` / `SandboxState`. Never fabricates |
| `packages/tools/src/testing/fake-driver.ts` | in-memory Docker for tests and `--fake-docker` |
| `apps/operator/src/agent.ts` | the agent: permission flow, events, audit, spoken lines |
| `apps/operator/ui/index.html` | ORANGE CRT face, viewer of the hub stream |
| `docker/sandbox/Dockerfile` | alpine + iputils, bind-tools, iproute2, curl, nc |

## Tools

| id | risk | approval | what |
|---|---|---|---|
| `sandbox_status` | LOW | no | Docker + sandbox state |
| `docker_sandbox` | MEDIUM | **yes** | create the isolated sandbox on the `--internal` lab network |
| `sandbox_ping` / `sandbox_dns` / `sandbox_http` / `sandbox_routes` / `sandbox_interfaces` / `sandbox_port_check` | LOW | no | allowlisted tests against loopback / `wasp-target` |
| `sandbox_destroy` | LOW | no | remove the sandbox |
| `sandbox_network_external` | HIGH | **yes** | attach the sandbox to a network with egress (leaves the lab) |

A `validation_request` without `tools` runs: `docker_sandbox → sandbox_ping 127.0.0.1 → sandbox_dns wasp-target → sandbox_http → sandbox_routes`
and stops at the first step that is not a success.

## Guarantees

* No tool = no execution. No arg in the allowlist = no execution. Extra keys = rejected.
* `requires_approval: true` + no `permission_granted` **from `security`** (the hub enforces the sender) = nothing runs.
* GREEN offline → approval-requiring tools are not run; CYAN is told. Never "assumed approved".
* Docker down → `sandbox_state { available: false, status: 'OFFLINE' }`, `tool_finished.status: 'unavailable'`, face `ERROR`, `warning`. Never "ready".
* Every result carries the exact `command` argv and `exit_code`. `command: []` means nothing ran.
* `--fake-docker` registers as `mode: 'stub'` and marks every payload `stub: true`; the hub refuses to mark the lab validated from it.
* Lab network is `--internal`: no egress. `sandbox_network_external` (HIGH) is the only way out and always needs approval.
