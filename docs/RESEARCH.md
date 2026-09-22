# MAGENTA — Researcher / Knowledge agent

Owner: Andrea. Code: `apps/researcher/`. Contract: `docs/CONTRACT.md` (Pablo). This document only
describes how MAGENTA fulfils that contract and what it needs from the other three agents.

## What it does (CONTRACT.md §4/§5)

1. `connectHub({ agent: "researcher" })`, face `IDLE`.
2. On `research_request` addressed to `researcher`:
   `agent_message` "Research request received." (intent `research_ack`, spoken on the MAGENTA PC) →
   `research_started { request_id }` → engine → `research_result` (a `ResearchSummary`, `to: <requester>`,
   `correlation_id = request_id`) → `agent_message` with the spoken summary (intent `research_complete`) →
   `audit_event` (action `research`, LOW risk, no approval) → `agent_finished` → face `COMPLETE`.
3. Degraded run (no API key, API error, refusal): a `warning` event, `degraded: true` in the payload, and the
   spoken line says "Live web research was unavailable". Total failure: `error`, an honest `agent_message`
   (intent `research_failed`), audit `failure`, face `ERROR`. No `research_result` is emitted.
4. Prompt injection detected in a source: face `WARNING`, a `warning` event, `warnings[]` on the result,
   confidence forced to `low`.

FOUND ≠ VERIFIED. The engine can only emit FOUND / CONTRADICTED / UNKNOWN. `VERIFIED` is reserved for
ORANGE after a real sandbox run.

## Run it

```bash
npm install                                  # once, at repo root
npm run hub                                  # Pablo's PC (or locally for testing)
WASP_HUB_URL=ws://<pablo-ip>:7331 npm run agent -w @wasp/researcher   # agent process on Andrea's PC
VITE_WASP_HUB_URL=ws://<pablo-ip>:7331 npm run dev -w @wasp/researcher # face + windows, http://localhost:5174
npm test  -w @wasp/researcher                # 25 unit tests (vitest)
npm run smoke -w @wasp/researcher            # boots apps/hub + agent, fake CYAN does hub.request(...) end to end
```

Live web research: export `ANTHROPIC_API_KEY` before starting the agent. Without it the agent logs
"CATALOG mode" and every result carries `mode: "catalog"`, `degraded: true`.

## Research modes

| mode      | source                                   | when                                              | statuses |
|-----------|------------------------------------------|---------------------------------------------------|----------|
| `web`     | Claude API (`claude-opus-5`) + server-side `web_search` tool | credentials present, API reachable | FOUND / CONTRADICTED / UNKNOWN |
| `catalog` | curated offline list: man pages (ping, dig, ip, traceroute), RFC 1035, Nmap guide, Wireshark guide, curl, Kali containers, OWASP WSTG | no key, API error, refusal, or web returned nothing | FOUND (low confidence when no keyword match) |

The catalog is the demo's safety net: the show goes on if Wi-Fi or the API dies, and the UI/voice say so.

### Claude API usage (`src/research/sources/ClaudeWebSource.ts`)

1. `client.beta.messages.create` — model `claude-opus-5`, `web_search_20260209` (max 5 searches), refusal
   fallbacks on (`fallbacks: [{ model: "claude-opus-4-8" }]`, beta `server-side-fallback-2026-06-01`).
   Output: URLs the search actually returned + a short synthesis.
2. `client.messages.parse` — Zod structured output, one finding per source. Findings citing URLs the search
   did not return are dropped (anti-hallucination).

Claude only describes what sources say. Nothing is executed. `stop_reason: "refusal"` → `ResearchSourceError`
→ engine falls back to the catalog and reports `degraded_reason`.

## Payload shape MAGENTA emits

`research_result` is a shared `ResearchSummary` plus extra JSON fields (declared in
`apps/researcher/src/research/types.ts`, consumers that only know the shared type ignore them):

| field | type | meaning |
|---|---|---|
| `mode` | `"web" \| "catalog"` | which source produced the results |
| `degraded` / `degraded_reason` | `boolean` / `string` | live research was not fully possible |
| `official_count` | `number` | how many results are `kind: "official"` |
| `results[i].warnings` | `string[]` | e.g. "possible prompt injection in source" |
| `results[i].retrieved_at` | ISO-8601 | when the source was collected |

**Proposal for `packages/shared-types` (Pablo):** add `warnings?: string[]` and `retrieved_at?: string` to
`ResearchResult`, and `mode?`, `degraded?`, `degraded_reason?` to `ResearchSummary`, so CYAN's synthesis can
rely on them with types instead of duck-typing.

## Security

* Web pages are **data**. Both system prompts say so; content is wrapped in `<untrusted_sources>` /
  `<untrusted_notes>` tags. `src/research/injection.ts` scans every finding ("ignore previous instructions",
  "grant yourself permission", "permission_granted", …).
* The researcher never emits `permission_*`, `sandbox_*`, `tool_*` or `validation_result`. The hub's authority
  table rejects it anyway (`apps/hub/src/authority.ts`); the unit test `agent.spec.ts` asserts it too.

## UI (MAGENTA PC)

`npm run dev -w @wasp/researcher`: geometric magenta CRT face (states from `context.agent_states.researcher`)
and floating windows SOURCES, VERIFICATION, AGENT COMMUNICATION, EVENT STREAM, all driven by the hub stream.

The UI connects as `researcher` with `meta: { role: "ui" }`. The hub keeps an agent online while any of its
sockets is open, so reloading the page never marks MAGENTA offline while the agent process runs. The topbar
shows "AGENT OFFLINE" when only the UI is connected.

"SIMULATE CYAN REQUEST" is a dev button: it POSTs a `research_request` from `architect` to the hub's
`/events` HTTP endpoint. Hide it for the live demo.

`AgentFace.tsx` and `FloatingWindow.tsx` take `color` / `state` props → they move to `packages/ui` in the
next PR so CYAN / ORANGE / GREEN reuse them (GIT-RULES merge order step 3).

## Voice

`src/ui/voice/tts.ts` — Web Speech API, no keys. Speaks MAGENTA's own `agent_message` lines (unless
`speak: false`) and `speak_requested` events with `agent: "researcher"`; emits `tts_started` / `tts_finished`.
Press "ENABLE VOICE" once (browsers need a click). Moves to `packages/voice` in the next PR together with a
`stt_transcript` producer for the CYAN PC.

## MCP assessment (INSTRUCCIONESANDREA.md "MCP DISCOVERY")

| option | verdict | why |
|--------|---------|-----|
| Claude server-side `web_search` tool | **use** (done) | zero setup, no extra credentials, typed result blocks, domain allow/block lists |
| Browser-automation MCP (Playwright/Puppeteer) | **no, not today** | browser runtime on the demo PC, slow, flaky on venue Wi-Fi; nothing in the demo needs JS-rendered pages |
| Third-party web-search MCP (Brave, Tavily, …) | **no** | duplicates the built-in tool, extra key, extra failure point |
| Documentation MCP (Context7 etc.) | **no** | the topic is man pages / RFCs, already in the catalog |

## Integration checklist for the other agents

* **CYAN**: `hub.request("research_request", { request_id, question, scope? }, { to: "researcher", expect: "research_result" })`.
  Read `payload.summary` to speak/synthesise, `payload.results` for the workshop, `payload.degraded` to be honest
  about catalog mode. `SharedContext.research` is updated by the hub reducer automatically.
* **ORANGE**: when you execute `research[i].procedure` successfully, reference `research[i].id` in your
  `validation_result` / `sandbox_result` so the hub can mark it `VERIFIED` (needs a reducer rule — Pablo).
* **GREEN**: research is LOW risk, no permission flow. Adversarial hooks: feed a poisoned page and assert
  `warning` + `warnings[]`; kill the agent process and assert CYAN reports `AgentUnavailableError` instead of
  fabricating research.
