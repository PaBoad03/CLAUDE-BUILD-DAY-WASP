# WASP — Integration Contract

**Read this before writing any code.** It is the one agreement the four agents share.
Source of truth for the shapes: `packages/shared-types/src/*.ts`. This doc explains how to use them.
Owner: Pablo/CYAN. To change the contract, open a small PR or ask Pablo; do not edit shared-types silently.

---

## 1. Topology

```
                 WASP HUB  (apps/hub, runs on Pablo's PC, port 7331)
                    │  WebSocket: every message is a WaspEvent (JSON)
    ┌───────────────┼───────────────┬───────────────┐
  CYAN           MAGENTA          ORANGE          GREEN
apps/architect  apps/researcher  apps/operator  apps/security
```

- The hub holds the **authoritative `SharedContext`**. Your local memory is a cache, never the truth.
- The hub **broadcasts every accepted event to every client** (sender included). Filter by `to` if you only care about yours.
- After any state change the hub broadcasts `context_updated` with the full context. Just replace your copy.
- HTTP for debugging/bridges: `GET /health`, `GET /context`, `GET /agents`, `GET /events?limit=100`, `POST /events`.

## 2. Connecting

```ts
import { connectHub } from '@wasp/event-bus';

const hub = await connectHub({ agent: 'researcher' });      // reads WASP_HUB_URL from env
hub.context;                                                // SharedContext (authoritative snapshot)
hub.on('research_request', (evt) => { ... });               // typed handler
hub.onMine('research_request', ...);                        // only events addressed to me / all
hub.emit('research_result', payload, { to: 'architect', correlation_id: evt.correlation_id });
hub.say('architect', 'Research request received.', 'ack'); // agent_message → visible + spoken
hub.setState('RESEARCHING');                                // agent_state → your face + everyone's UI
hub.audit({ action: '...', status: 'success', approval_required: false });
const res = await hub.request('permission_requested', req, { to: 'security', expect: ['permission_granted','permission_denied','permission_cancelled'] });
```

First message on a socket must be `agent_registered` (the client does it for you). Register with `mode: 'stub'` only for fake responders.

**UI windows** connect as their agent with `meta: { role: 'ui' }` (`new HubClient({ agent: 'operator', meta: { role: 'ui' } })` or a raw `agent_registered` frame). The hub streams everything to them but they **do not count as presence**: `agents.operator.status` reflects only the agent process. UIs emit only `tts_*`; human input (buttons, mic) enters through `POST /events` as `from: 'human'` (`user_message`, `user_authorization`). See `apps/security/ui/index.html` for the pattern.

`hub.request()` throws `AgentUnavailableError` if the target is offline and `RequestTimeoutError` on silence. **Do not catch these and pretend it worked.** Say the agent is offline.

## 3. The envelope

```json
{
  "id": "evt_...",
  "type": "research_request",
  "session_id": "sess_...",
  "from": "architect",
  "to": "researcher",
  "timestamp": "2026-09-21T14:00:00.000Z",
  "payload": { ... },
  "correlation_id": "req_..."
}
```

`correlation_id` ties a response to its request. Use the `request_id` / `permission_id` from the payload. Always echo it back.

## 4. Who emits what (enforced by the hub — `apps/hub/src/authority.ts`)

| Event | Emitted by | Received by | Purpose |
|---|---|---|---|
| `user_message` | architect (voice/UI bridge), human | all | Human spoke to WASP |
| `agent_message` | anyone | anyone | The visible/audible agent line. `intent` labels it, `speak` controls TTS |
| `agent_state` | anyone | all | Face state (`FaceState`) |
| `research_request` → `research_started`, `research_result` | architect → researcher → architect | | `ResearchRequest` / `ResearchSummary`. FOUND ≠ VERIFIED |
| `validation_request` → `validation_result` | architect → operator → architect | | `ValidationRequest` / `ValidationResult`. `validated` true only after a real successful test |
| `tools_registered`, `tool_requested`, `tool_started`, `tool_finished` | operator | all | `ToolDefinition`, `ToolRequest`, `ToolResult` with **real** output |
| `sandbox_state`, `sandbox_started`, `sandbox_test`, `sandbox_result` | operator | all | `SandboxState`; Docker OFFLINE is a valid, honest state |
| `permission_requested` | anyone (usually operator) | security | `PermissionRequest` |
| `permission_required` | **security only** | architect | `PermissionEvaluation`: "a human must decide, here is what to ask" |
| `user_authorization` | architect (voice/UI/CLI), human | security | `HumanAuthorization`: YES / NO / STOP / AMBIGUOUS + raw transcript |
| `permission_clarification_needed` | **security only** | architect | Speech was ambiguous, ask again |
| `permission_granted` / `permission_denied` / `permission_cancelled` | **security only** | all | `PermissionDecision`. Recorded in context |
| `speak_requested` → `tts_started` / `tts_finished` | anyone → voice layer | | Voice layer (Andrea) speaks on the PC whose color matches `agent` |
| `stt_transcript` | voice layer | architect | Human speech recognized |
| `workshop_updated`, `decision_made`, `session_state`, `final_response` | architect | all | Task lifecycle |
| `audit_event` | anyone | all | `AuditEntry`. Also persisted by hub to `audit/<session>.jsonl` |
| `warning`, `error` | anyone | all | |
| `session_snapshot`, `context_updated`, `agent_offline`, `hub_error` | hub | | |

Events sent by an unauthorized `from` are rejected with `hub_error` and an `audit_event`.

## 5. The demo flow, as events

```
human      → architect   user_message
architect  → researcher  agent_message "Researcher, I need evidence..."      (spoken on CYAN PC)
architect  → researcher  research_request                                    corr=req1
researcher → architect   agent_message "Research request received."         (spoken on MAGENTA PC)
researcher → architect   research_result                                     corr=req1
architect  → operator    validation_request                                  corr=req2
operator   → security    agent_message "Security, I need authorization..."
operator   → security    permission_requested                                corr=perm1
security   → architect   permission_required   { human_prompt }              corr=perm1
architect  → human       agent_message / speak_requested "Pablo, may I proceed?"
human      → security    user_authorization    { decision: YES, raw: "sí" }  corr=perm1
security   → all         permission_granted                                  corr=perm1
operator   → all         sandbox_started, tool_started, tool_finished (real output), audit_event
operator   → architect   validation_result     { validated: true/false }     corr=req2
architect  → all         workshop_updated, final_response, speak_requested
```

If researcher/operator is offline, `hub.request` throws and CYAN says so. The final `WorkshopSpec.lab.validated` stays `false`.

## 6. Hub guarantees (so GREEN can rely on them)

- `permission_*` decisions accepted **only from `security`**.
- A socket may only send events `from` the agent it registered as.
- `workshop.lab.validated` can only become `true` via a `validation_result` from `operator` that is not a stub and contains a successful non-stub test. `workshop_updated` cannot flip it.
- Stub agents register as `mode: 'stub'`; every stub payload has `stub: true`; UIs must show it.
- Every `audit_event` is appended to disk by the hub.

## 7. Running

```bash
npm install
npm run hub                         # Pablo's PC. Others set WASP_HUB_URL=ws://<pablo-ip>:7331
npm run stubs                       # fake researcher+operator+security, for solo testing
npm run stubs -- operator security  # only the ones you are NOT building
npm run architect -- "WASP, create a two-hour beginner network reconnaissance workshop."
npm test && npm run typecheck
```

## 8. Tool ids (ORANGE registry, GREEN policy, CYAN plans — one vocabulary)

`schemas/tools.json` is the registry. ORANGE emits it as `tools_registered`; GREEN merges it into its policies (may escalate, never lower). Use these ids in `PermissionRequest.operation`, `ToolRequest.tool_id`, `ValidationRequest.tools`:

| id | risk | approval |
|---|---|---|
| `sandbox_status`, `sandbox_ping`, `sandbox_dns`, `sandbox_http`, `sandbox_routes`, `sandbox_interfaces`, `sandbox_destroy` | LOW | no (GREEN auto-approves and audits) |
| `docker_sandbox` | MEDIUM | **human** |
| `sandbox_port_check` | LOW (ORANGE) / MEDIUM (GREEN) | human |
| `sandbox_network_external` | HIGH | **human** |
| `host_shell`, `external_scan`, `destructive` | CRITICAL | **BLOCKED**, even with a human yes |

A `validation_request` without `tools` makes ORANGE run `docker_sandbox → sandbox_ping → sandbox_dns → sandbox_http → sandbox_routes` and stop at the first non-success.

## 9. Changelog

**v1.1 — 2026-09-22 (integration of magenta / orange / green).** All additive:
- `ResearchResult.warnings?`, `retrieved_at?`; `ResearchSummary.mode?`, `degraded?`, `degraded_reason?`, `official_count?` (MAGENTA).
- `ToolStatus` gains `rejected` (never reached execution). `ToolResult` gains `summary?`, `command?` (exact argv), `exit_code?`, `input?`, `permission_id?`. `SandboxState` gains `docker_version?`, `target_available?`. `ToolRequest.reason?`.
- `ValidationRequest.research_ids?` → `ValidationResult.verifies_research_ids?`: the reducer flips those research results FOUND → VERIFIED only on a real, non-stub, successful validation.
- `tool_started.permission_id?` so GREEN can check every start against a GRANTED permission.
- `PermissionStatus` gains `BLOCKED`; `PermissionDecision.rationale?`. GREEN emits `permission_denied { status: 'BLOCKED' }` for CRITICAL and `permission_cancelled { status: 'EXPIRED' }` on timeout.
- UI sockets (`meta.role = 'ui'`) no longer affect presence (§2). `@wasp/event-bus/testing` exports `FakeHub` for every agent's unit tests.

## 10. Adding something to the contract

1. Add the type in `packages/shared-types/src/*.ts` and, if it is an event, to `EventPayloads` + `EVENT_TYPES` in `events.ts`.
2. If a specific agent must own it, add it to `apps/hub/src/authority.ts`.
3. If it changes shared state, handle it in `apps/hub/src/reducer.ts` and add a test.
4. Small PR. Pablo merges fast.
