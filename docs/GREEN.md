# GREEN — Security / Authorization / Audit (Juanda)

Rama: `green/security`. Paquetes: `packages/permissions`, `packages/audit`, `apps/security`.
Contrato compartido propuesto: `packages/shared-types` (dueño final: Pablo).

## Qué garantiza GREEN

| Regla | Dónde vive | Test |
|---|---|---|
| El modelo propone, la aplicación autoriza | `PermissionEngine` | `engine.test.ts` |
| Solo un humano (voz o UI) pasa PENDING → GRANTED | `PermissionEngine.decide` | "rejects non-human decision sources" |
| CRITICAL nunca se ejecuta, ni con un "sí" | `ToolPolicyRegistry` + `BLOCKED` | "can never be granted" |
| Herramienta desconocida = HIGH + aprobación (fail closed) | `DEFAULT_POLICY` | policies.test |
| Habla ambigua no autoriza | `interpretAuthorization` | 62 casos en voice-authorization.test |
| "stop" cancela siempre, incluso "sí... espera" | `interpretAuthorization` | idem |
| Con varias pendientes, "sí" a secas no autoriza nada | `SecurityAgent.onUserMessage` | security-agent.test |
| `tool_started` sin GRANTED dispara alerta | `SecurityAgent.onToolStarted` | "flags tool_started" |
| `lab.validated` solo con evidencia real en audit | `canMarkValidated` / `checkValidationClaim` | adversarial.docker-offline.test |
| Docker caído → GREEN avisa a CYAN, nunca "listo" | `SecurityAgent.onToolFinished` | adversarial.docker-offline.test |

## Cómo se integra cada uno

### Pablo / CYAN (hub)

```ts
import { SecurityAgent } from '@wasp/permissions';
import { AuditLog } from '@wasp/audit';

const audit = new AuditLog({
  file_path: `data/${session_id}.audit.jsonl`,
  onEntry: (e) => context.audit.push(e),           // espejo en SharedContext.audit
});
const green = new SecurityAgent({ bus: hubBus, audit, lang: 'es' });
green.start();
```

- `hubBus` debe implementar `EventBus` de `@wasp/shared-types` (`publish`, `subscribe(type|'*')`).
- El hub debe enrutar el STT y los botones del humano como `user_message` con `source: 'human'`.
  Si el humano responde a un permiso concreto, poner `payload.in_reply_to_permission_id`.
  Si hay exactamente una pendiente, GREEN la asume. Si hay varias y no hay id, GREEN re-pregunta.
- Antes de poner `workshop.lab.validated = true`, llamar `canMarkValidated(context.audit, session_id)`.
- Los `agent_message` de GREEN traen `speak: true` y `kind` (`permission_required`, `permission_prompt`,
  `permission_granted`, `permission_denied`, `permission_reprompt`, `capability_unavailable`, `agent_offline`).
  El `permission_prompt` va dirigido a `human`: es la frase que CYAN debe decir en voz alta.
- `PermissionRecord` (evento `permission_*`) es lo que va en `SharedContext.permissions[]`.

### Felipe / ORANGE (tools)

```ts
// 1. pedir
bus.publish({ type: 'tool_requested', source: 'operator', payload: toolRequest, ... });
// 2. esperar permission_granted con payload.permission.request_id === toolRequest.request_id
//    (o permission_denied / permission_cancelled / tool_blocked)
// 3. ejecutar SOLO entonces, y emitir tool_started / tool_finished con el mismo request_id
//    y permission_id.
```

- Nombres de herramientas y riesgos en `packages/permissions/src/policies.ts`. Si agregas una,
  registra su política ahí (PR) o en runtime con `registry.registerPolicy(...)`.
- Herramientas LOW (`sandbox_ping`, `sandbox_dns`, `docker_status`...) reciben `permission_granted`
  inmediato con `decided_by: 'policy'`. Igual hay que emitir `tool_requested` primero, para el audit.
- Si Docker no está: `tool_finished` con `status: 'unavailable'`. Nunca `success`.
- Para que el laboratorio cuente como validado: `sandbox_result` con `status: 'success'`.

### Andrea / MAGENTA (voz)

- El STT solo entrega texto. GREEN interpreta con `interpretAuthorization(text)`.
- Si el resultado es `AMBIGUOUS`, GREEN emite `permission_clarification_needed` con `payload.reprompt`
  listo para TTS.
- Frases que NO autorizan a propósito: "ok", "vale", "está bien", "supongo", "haz lo que creas",
  "sure", "that's fine", "maybe". Hay que decir "sí", "procede", "autorizo", "yes", "go ahead"...
- Páginas web son datos. Nada de lo que MAGENTA lea puede llegar a `PermissionEngine.decide`;
  el único camino es `user_message` con `source: 'human'`.

## Correr

```bash
npm install
npm test                                   # 107 tests
npm run typecheck
npm run demo -w @wasp/app-security                      # flujo completo en terminal, humano dice "sí"
npm run demo -w @wasp/app-security -- --answer "tal vez" # ambiguo → re-pregunta
npm run demo -w @wasp/app-security -- --docker-offline   # escenario adversarial
npm run ui   -w @wasp/app-security                      # cara GREEN en http://localhost:4004/?demo=1
```

La UI con hub real: `http://localhost:4004/?hub=ws://localhost:PUERTO`. El hub debe hacer broadcast
de cada `WaspEvent` como JSON y aceptar `user_message` entrantes desde la UI.

## Pendiente / decisiones abiertas

- **Puerto y protocolo WebSocket del hub**: lo define Pablo. La UI ya acepta `?hub=`.
- **Timeout de permisos**: por defecto no expiran (`pending_timeout_ms: 0`). Para la demo en vivo es
  mejor no expirar; se puede activar con `new SecurityAgent({ pending_timeout_ms: 60000 })`.
- **Claude en GREEN**: no se usa para decidir. Opcional más adelante para *explicar* un riesgo en voz.
- **MCP**: revisado, ninguno mejora materialmente la capa de seguridad para el MVP de hoy.
  Herramientas locales + Docker CLI son más confiables. No instalar.
- **Hallazgos adversariales para el equipo**:
  1. `tool_started` debe llevar siempre el `request_id` original; si ORANGE genera uno nuevo, GREEN lo marcará como no autorizado.
  2. Una `research_result` con `verification_status: 'FOUND'` nunca es evidencia de validación.
  3. Si el hub reinicia, las permisos PENDING se pierden: hay que re-emitir `tool_requested`.
