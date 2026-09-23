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

**One PC, one command (Windows):** `.\wasp.ps1` opens every process in its own window, waits for the hub, opens the CYAN face and tells you which URL to open for each face. `.\wasp.ps1 -Stubs` for a fast rehearsal without MAGENTA/ORANGE, `-Request "..."` to skip the mic, `.\wasp.ps1 -Stop` to shut everything down.

```bash
npm install                      # Node >= 20, npm workspaces, no pnpm needed
cp .env.example .env             # set WASP_HUB_URL=ws://<pablo-ip>:7331 unless you are Pablo

npm run hub                      # Pablo's PC only — authoritative shared context on :7331
npm run architect:ui             # CYAN face on :5173 — mic → WASP, TTS for CYAN's lines, every window of the shared context
npm run researcher               # Andrea's PC  (MAGENTA agent; face: npm run researcher:ui on :5174)
npm run operator                 # Felipe's PC  (ORANGE agent; --fake-docker without Docker)   face: npm run operator:ui  (:7003)
npm run security                 # Juanda's PC  (GREEN agent)                                    face: npm run security:ui  (:7004)
npm run stubs -- operator security   # fake any agent that is not running, so you can test alone
npm run architect -- "WASP, create a two-hour beginner network reconnaissance workshop."
npm run architect                # no request: WASP listens — speak into the CYAN face (mic) or type there

npm run typecheck && npm test    # node:test across every package; MAGENTA's vitest: npm test -w @wasp/researcher
```

CYAN orchestrates with Claude (`claude-opus-5`, structured tool calls) when `ANTHROPIC_API_KEY` is set; without it the fixed reference flow runs and says so. Set `WASP_CLAUDE_EFFORT` (default `medium`) to trade latency for depth.

Solo rehearsal on one PC (no Docker): `npm run hub` · `npm run stubs -- researcher` · `npm run operator -- --fake-docker` · `npm run security` · `WASP_AUTO_ANSWER=yes npm run architect`.

Open `http://<pablo-ip>:7331/context` in a browser to see the live shared context.

## Layout

```
apps/
  hub/          WASP HUB: WebSocket + HTTP, SharedContext reducer, authority rules, stub agents   (Pablo)
  architect/    CYAN orchestrator: Claude tool loop (src/orchestrator.ts) + CYAN face (src/ui)         (Pablo)
  researcher/   MAGENTA research engine + UI + voice behavior                                     (Andrea)
  operator/     ORANGE docker sandbox, tool registry, safe execution                              (Felipe)
  security/     GREEN authorization engine, audit, adversarial tests                              (Juanda)
packages/
  shared-types/ THE contract: agents, events, context, permissions, research, tools, workshop, audit (Pablo)
  event-bus/    HubClient: connect, emit, on, request/response, say, setState, audit              (Pablo)
  voice/        Browser TTS (VoiceOutput → tts_*) + STT (VoiceInput → stt_transcript), per-agent voices (Andrea)
  ui/           Shared 3D face (Three.js, procedural mask, looks around, glitches) + floating windows + useHub(agent) (Andrea)
  permissions/  Risk classification + authorization engine + GREEN agent runtime                  (Juanda)
  audit/        Audit view of the hub stream + lab.validated guard                                (Juanda)
  tools/        Tool registry + allowlisted Docker executor                                       (Felipe)
schemas/        JSON Schema mirrors of the main contracts (Pablo); tools.json = tool registry     (Felipe)
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
