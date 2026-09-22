# WASP — CLAUDE BUILD DAY

Multi-agent AI operations system powered by the Claude API.
**Four agents. One hub. One context. One event stream. One human in control.**

| Agent | Color | Owner | Folder |
|---|---|---|---|
| Architect / Orchestrator | 🩵 CYAN | Pablo | `apps/architect` |
| Researcher / Knowledge | 🩷 MAGENTA | Andrea | `apps/researcher` |
| Operator / Sandbox | 🟠 ORANGE | Felipe | `apps/operator` |
| Security / Auditor | 🟢 GREEN | Juanda | `apps/security` |

## Read first

1. `CONTEXT.md` — the shared vision and rules for the whole team.
2. `INSTRUCCIONES<YOU>.md` — your agent's brief.
3. `docs/CONTRACT.md` — **how your agent plugs into the hub** (events, payloads, who may emit what).
4. `docs/GIT-RULES.md` — branches, folders, how not to step on each other.

## Quick start

```bash
npm install                      # Node >= 20, npm workspaces, no pnpm needed
cp .env.example .env             # set WASP_HUB_URL=ws://<pablo-ip>:7331 unless you are Pablo

npm run hub                      # Pablo's PC only — authoritative shared context on :7331
npm run stubs                    # fake MAGENTA/ORANGE/GREEN so you can test alone
npm run stubs -- operator security   # only the agents you are NOT building
npm run architect -- "WASP, create a two-hour beginner network reconnaissance workshop."

npm run typecheck && npm test
```

Open `http://<pablo-ip>:7331/context` in a browser to see the live shared context.

## Layout

```
apps/
  hub/          WASP HUB: WebSocket + HTTP, SharedContext reducer, authority rules, stub agents   (Pablo)
  architect/    CYAN orchestrator                                                                 (Pablo)
  researcher/   MAGENTA research engine + UI + voice behavior                                     (Andrea)
  operator/     ORANGE docker sandbox, tool registry, safe execution                              (Felipe)
  security/     GREEN authorization engine, audit, adversarial tests                              (Juanda)
packages/
  shared-types/ THE contract: agents, events, context, permissions, research, tools, workshop, audit (Pablo)
  event-bus/    HubClient: connect, emit, on, request/response, say, setState, audit              (Pablo)
  voice/        TTS/STT layer consuming speak_requested / emitting stt_transcript                 (Andrea)
  ui/           Shared face component + floating windows, parameterized by agent color            (Andrea)
  permissions/  Risk classification + authorization engine                                        (Juanda)
schemas/        JSON Schema mirrors of the main contracts                                         (Pablo)
docker/         Sandbox images                                                                    (Felipe)
docs/           CONTRACT.md, GIT-RULES.md, decisions
```

## Non-negotiables

- The hub is authoritative. Local memory is a cache.
- Structured events are the system. Audio is the experience.
- The model proposes. The application authorizes. The tool executes. The audit records.
- Only GREEN emits permission decisions. The hub rejects anyone else.
- `workshop.lab.validated` is `false` until a real test succeeds. Stubs cannot flip it.
- If an agent is offline, WASP says so. It never fabricates success.
