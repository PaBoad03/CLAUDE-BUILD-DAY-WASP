# 🟠 ORANGE — Operator / Sandbox (owner: Felipe)

The ORANGE agent turns approved requests into real, allowlisted execution
inside a Docker sandbox, and reports exactly what happened. It never
authorizes itself.

```
CYAN/MAGENTA ─ tool_requested / validation_request (to: operator) ─▶ ORANGE
ORANGE ─ permission_requested (to: security) ─▶ GREEN            (always, even LOW risk)
GREEN  ─ permission_granted | permission_denied (to: operator) ─▶ ORANGE   (only if requires_approval)
ORANGE ─ tool_started → [docker exec fixed argv] → tool_finished, sandbox_*, audit_event, validation_result
```

## Run

```bash
cd apps/operator && npm install
npm run sandbox:build                       # once, before the demo (builds image, pulls nginx:alpine)
npm start -- --hub ws://<hub-ip>:<port>     # normal mode: connect to the WASP HUB
npm run demo                                # standalone: terminal plays CYAN + GREEN + human
npm run demo:fake                           # same without Docker (FakeDriver)
npm test                                    # 10 agent tests; packages/tools has 15 more
```

UI (ORANGE face + DOCKER / TERMINAL / RESULT windows): http://localhost:7003
Flags: `--ui-port 0` disables it, `--tts say` uses macOS TTS until `packages/voice` exists.

## Layout

| path | what |
|---|---|
| `schemas/tools.json` | **tool registry**: name, risk, requires_approval, arg allowlists. Single source of truth. GREEN reads it too. |
| `packages/tools/src/contracts.ts` | local mirror of shared types → to be replaced by `packages/shared-types` |
| `packages/tools/src/registry.ts` | loads/validates the registry; rejects unknown tools, unknown args, off-list values, shell chars |
| `packages/tools/src/docker.ts` | `SandboxDriver` interface + `DockerCliDriver` (argv-only, no shell) |
| `packages/tools/src/executor.ts` | maps tool → fixed argv, parses results, never fabricates |
| `apps/operator/src/agent.ts` | the agent: permission flow, events, audit, TTS lines |
| `apps/operator/src/bus.ts` | `Bus` interface, `InMemoryBus`, `WebSocketBus` (hub client) |
| `apps/operator/ui/index.html` | ORANGE CRT face, read-only mirror of the bus |
| `docker/sandbox/Dockerfile` | alpine + iputils, bind-tools, iproute2, curl, nc |

## Integration contract (what the other three need to know)

**Pablo / hub.** `WebSocketBus` assumes one JSON `WaspEvent` per frame, both
directions, and sends `agent_started` on connect. Events have
`event_id, session_id, timestamp, type, from, to, payload`. `to` is an agent
id or `"broadcast"`. ORANGE only acts on events with `to: "operator"`.
If your framing differs, only `bus.ts` `encode/decode` needs to change.

**Pablo / architect.** Send:
```json
{ "type": "validation_request", "to": "operator",
  "payload": { "request_id": "…", "tool": "sandbox_ping", "args": { "target": "127.0.0.1" }, "reason": "…", "requested_by": "architect" } }
```
You get back `validation_result` (`validated: boolean`, `status`, `summary`,
`evidence`) addressed to you, plus a broadcast `tool_finished` with the full
`ToolResult`. `validated` is only ever true on real `status: "success"`.
Use `tool_requested` instead when you don't need a `validation_result`.
Typical sequence for the workshop lab: `sandbox_status` → `sandbox_create` (needs approval)
→ `sandbox_ping` → `sandbox_dns` → `sandbox_http` → `sandbox_routes`.

**Juanda / security.** You receive `permission_requested` for *every* tool
call with `{request_id, tool, args, risk, requires_approval, reason, requested_by, summary}`.
Risk comes from `schemas/tools.json`; you may escalate. Reply with
`permission_granted` / `permission_denied` **from `security` to `operator`**
carrying `{request_id, granted, decided_by: "human"|"policy", user_authorization?, reason?}`.
ORANGE ignores decisions from any other sender and any unmatched `request_id`.
If nothing arrives within 120 s the request is reported as `approval_status: "timeout"`
and nothing runs. Every execution ends with an `audit_event` shaped per CONTEXT.md §19.

**Andrea / voice.** Every spoken line is also an `agent_message` event with
`payload.spoken: true`, so the shared TTS can voice ORANGE without touching
this code. `Speaker` in `voice.ts` is the seam if you prefer direct injection.

## Guarantees

* No tool = no execution. No arg in the allowlist = no execution. Extra keys = rejected.
* `requires_approval: true` + no `permission_granted` from `security` = nothing runs.
* Docker down → `status: "unavailable"`, face `OFFLINE`, `warning` event. Never "ready".
* Every result carries the exact `command` argv and `exit_code`. `command: []` means nothing ran.
* Lab network is `--internal`: no egress. `sandbox_network_external` (HIGH) is the only way out and always needs approval.
