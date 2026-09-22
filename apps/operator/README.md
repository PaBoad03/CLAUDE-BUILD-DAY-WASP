# apps/operator — 🟠 ORANGE (Felipe)

Your folder. Build the tool registry, Docker sandbox, safe execution layer and ORANGE UI/voice here.

Start from `docs/CONTRACT.md`. Minimal viable agent:

```ts
import { connectHub } from '@wasp/event-bus';
const hub = await connectHub({ agent: 'operator' });
hub.emit('tools_registered', { tools });                       // ToolDefinition[] with available:false + reason if Docker is missing
hub.emit('sandbox_state', { available, status, network: 'NONE' });
hub.onMine('validation_request', async (evt) => {
  const decision = await hub.request('permission_requested', permReq, { to: 'security', expect: ['permission_granted','permission_denied','permission_cancelled'], correlation_id: permReq.permission_id, timeoutMs: 120000 });
  if (decision.type !== 'permission_granted') { /* emit validation_result validated:false */ return; }
  // run the REAL test, emit tool_started / tool_finished with real output, audit_event
  hub.emit('validation_result', { request_id, validated: realSuccess, tests, summary }, { to: 'architect', correlation_id: evt.correlation_id });
});
```

Claude never gets a shell. Only allowlisted tools run. If Docker is unavailable, say so: `status: 'unavailable'`.
A stub version of you lives in `apps/hub/src/stubs.ts`.
