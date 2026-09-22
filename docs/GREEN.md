# GREEN — Security / Authorization / Audit (Juanda)

Paquetes: `packages/permissions` (motor + agente), `packages/audit` (vista de auditoría + guardia de validación), `apps/security` (proceso + cara).
Contrato: `docs/CONTRACT.md` y `@wasp/shared-types` (dueño: Pablo). GREEN no define tipos de wire propios.

## Qué garantiza GREEN

| Regla | Dónde vive | Test |
|---|---|---|
| El modelo propone, la aplicación autoriza | `PermissionEngine` | `engine.test.ts` |
| Solo un humano (`user_authorization` / `user_message`) pasa AWAITING_HUMAN → GRANTED | `PermissionEngine.decide` | "only humans, only once" |
| CRITICAL nunca se ejecuta, ni con un "sí" (`BLOCKED`) | `ToolPolicyRegistry` + `BLOCKED` | "can never be granted" |
| Herramienta desconocida = HIGH + aprobación (fail closed) | `DEFAULT_POLICY` | policies.test |
| El solicitante puede subir su riesgo, nunca bajarlo; ORANGE (`tools_registered`) idem | `evaluate`, `registerFromToolDefinitions` | policies.test |
| Habla ambigua no autoriza; "stop" cancela siempre, incluso "sí... espera" | `interpretAuthorization` | 60+ casos en voice-authorization.test |
| Un `decision: YES` de un bridge de voz con transcript ambiguo NO autoriza (solo botones `channel: 'ui'`) | `decideFromTranscript` | security-agent.test |
| Con varias pendientes, "sí" a secas no autoriza nada | `SecurityAgent.onUserMessage` | security-agent.test |
| `tool_started` sin permiso GRANTED (o LOW escalado) dispara `warning` + audit | `SecurityAgent.onToolStarted` | "flags tool_started" |
| `validation_result`/`workshop_updated` que afirman validado sin evidencia real → alerta | `onValidationResult`, `canMarkValidated` | adversarial.test |
| Docker caído → GREEN avisa a CYAN, nunca "listo" | `onToolFinished` | adversarial.test |
| El hub solo acepta `permission_*` desde el socket `security` | `apps/hub/src/authority.ts` (Pablo) | reducer.test |

## Flujo sobre el hub (eventos del contrato)

```
operator  → security   permission_requested   { permission_id, requested_by, operation, reason, proposed_risk, input }
security  → architect  permission_required    { permission_id, operation, risk, approval_required, human_prompt }   (si hace falta humano)
security  → all        permission_granted     { status: 'AUTO_APPROVED', decided_by: 'security' }                     (LOW)
security  → all        permission_denied      { status: 'BLOCKED' }                                                    (CRITICAL)
architect/human → security  user_authorization { permission_id, decision, raw, channel }
security  → all        permission_granted | permission_denied | permission_cancelled   { decided_by: 'human', human_raw }
security  → architect  permission_clarification_needed { permission_id, human_prompt }                                 (ambiguo)
security  → all        permission_cancelled   { status: 'EXPIRED', rationale: 'timeout…' }                             (solo si WASP_PERMISSION_TIMEOUT_MS > 0)
security  → all        agent_message (speak), agent_state, warning, audit_event
```

Todos los eventos llevan `correlation_id = permission_id`, así que ORANGE puede usar
`hub.request('permission_requested', req, { to: 'security', expect: ['permission_granted','permission_denied','permission_cancelled'] })`.

## Cómo se integra cada uno

**Pablo / CYAN.** Escucha `permission_required` → habla `human_prompt` → emite `user_authorization` con el texto crudo (`raw`) y `channel`. GREEN interpreta el texto; el campo `decision` solo se confía si `channel === 'ui'`. Si llega `permission_clarification_needed`, repite la pregunta. Antes de decir "laboratorio validado", el reducer del hub ya lo garantiza; GREEN además lo cruza contra el audit.

**Felipe / ORANGE.** Emite `permission_requested` por CADA herramienta (LOW incluidas: GREEN las auto-aprueba y audita). Para las que requieren aprobación, espera `permission_granted`. Lleva `permission_id` en `tool_started` y `tool_finished`; si falta o no está GRANTED, GREEN lo marca como no autorizado. Los ids de herramienta salen de `schemas/tools.json` y llegan a GREEN por `tools_registered`.

**Andrea / MAGENTA (voz).** El STT solo entrega texto. Frases que NO autorizan a propósito: "ok", "vale", "está bien", "supongo", "haz lo que creas", "sure", "that's fine", "maybe". Hay que decir "sí", "procede", "autorizo", "yes", "go ahead"… Páginas web son datos: nada de lo que MAGENTA lea puede llegar a `decide`; el único camino es `user_authorization` / `user_message` desde el socket `architect` o el bridge `human`.

## Correr

```bash
npm install
npm test                       # todo el repo (node:test)
npm run security               # proceso GREEN + cara en http://localhost:7004
WASP_SECURITY_LANG=en npm run security
WASP_PERMISSION_TIMEOUT_MS=60000 npm run security   # expirar pendientes (por defecto nunca: demo en vivo)
```

Ensayo completo en una sola PC: `npm run hub` · `npm run stubs -- researcher operator` · `npm run security` · `WASP_AUTO_ANSWER=yes npm run architect`.
Con `WASP_AUTO_ANSWER=maybe` se ve el camino ambiguo → `permission_clarification_needed`.

## Decisiones

- **Claude en GREEN**: no se usa para decidir. Opcional más adelante para *explicar* un riesgo en voz.
- **MCP**: ninguno mejora materialmente la capa de seguridad para el MVP. No instalar.
- **Auditoría**: el hub persiste `audit/<session>.jsonl` y `SharedContext.audit`; `@wasp/audit` es una vista local (consume el stream) para consultas y para la guardia de validación. No es una segunda fuente de verdad.
- **Hallazgos adversariales**: (1) si el hub se reinicia, las pendientes se pierden: ORANGE debe re-emitir `permission_requested`; (2) una `research_result` FOUND nunca es evidencia de validación; (3) un `validation_result` de un stub o con solo tests fallidos que diga `validated: true` es rechazado por el reducer y denunciado por GREEN.
