# apps/security — 🟢 GREEN (Juanda)

Your folder. Build the authorization engine, risk classification, human voice confirmation, audit log, adversarial tests and GREEN UI/voice here.

Start from `docs/CONTRACT.md`. Minimal viable agent:

```ts
import { connectHub } from '@wasp/event-bus';
const hub = await connectHub({ agent: 'security' });
hub.onMine('permission_requested', (evt) => {
  const risk = classify(evt.payload);                                   // LOW | MEDIUM | HIGH | CRITICAL
  hub.emit('permission_required', { permission_id, operation, risk, approval_required: risk !== 'LOW', human_prompt }, { to: 'architect', correlation_id: permission_id });
});
hub.on('user_authorization', (evt) => {
  // YES → permission_granted, NO → permission_denied, STOP → permission_cancelled, AMBIGUOUS → permission_clarification_needed
  // always emit audit_event
});
```

Hub guarantees you can build on (and should try to break): only `security` may emit `permission_*` decisions; a socket can only speak as the agent it registered as; stubs cannot set `validated: true`. See `apps/hub/src/authority.ts` and `apps/hub/src/reducer.test.ts`. If you find a hole, open an issue or a tiny PR there.

A stub version of you lives in `apps/hub/src/stubs.ts`.
