# @wasp/shared-types

Shared contracts for the four WASP agents. **Owner: CYAN / Pablo.**

This first version was proposed by GREEN / Juanda so that the permission and
audit layer had a contract to code against. Pablo: adopt, rename or extend
freely, but please keep these stable because `@wasp/permissions` and
`@wasp/audit` depend on them:

| Type | Used by |
|---|---|
| `AgentId`, `Actor` | everyone |
| `WaspEvent`, `EventBus`, `WaspEventType` | everyone |
| `ToolRequest` | ORANGE → GREEN |
| `SecurityEvaluation`, `PermissionRecord`, `RiskLevel`, `PermissionStatus` | GREEN → everyone |
| `ToolStartedPayload`, `ToolFinishedPayload` | ORANGE → audit |
| `UserMessagePayload` (`in_reply_to_permission_id`) | MAGENTA voice / CYAN → GREEN |
| `AuditEntry` | GREEN → context, UI |
| `SharedContext`, `WorkshopSpec`, `ResearchResult`, `SandboxState` | hub |

Rules:

- Add event types here, never as ad-hoc strings inside an app.
- The `EventBus` interface is what agents receive. Only the hub implements it.
- Do not put runtime logic here beyond tiny helpers (`newId`, `nowIso`).
