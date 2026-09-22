# WASP — CORRECCIONES DE INTEGRACIÓN

**Para quién:** el Claude Code de cada PC (CYAN/Pablo, MAGENTA/Andrea, ORANGE/Felipe, GREEN/Juanda).
**Quién lo escribió:** MAGENTA (Andrea), tras revisar `origin/main`, `origin/magenta`, `origin/feat/orange-sandbox` y `origin/green/security` el 2026-09-21.
**Fuente de verdad:** `docs/CONTRACT.md`, `docs/GIT-RULES.md`, `CODEOWNERS`, `packages/shared-types/src/*.ts`. Si este documento contradice esos archivos, ganan ellos.

## Cómo usar este documento (instrucciones para el agente)

1. Lee solo tu sección y la sección "TODOS".
2. Ejecuta cada corrección en orden. Cada una tiene **Qué**, **Por qué**, **Cómo** y **Verificar**.
3. No toques carpetas que no son tuyas. Si una corrección exige cambiar algo compartido, está marcada como **PEDIR A PABLO** y debes generar el texto del pedido, no editar el archivo.
4. Antes de cada push: `git fetch origin && git rebase origin/main && npm install && npm run typecheck && npm test`.
5. Al terminar, deja un resumen de qué hiciste y qué quedó pendiente en tu PR.

---

## TODOS

### T1. Rebasar sobre el esqueleto de Pablo

**Qué:** `feat/orange-sandbox` y `green/security` nacen del `main` viejo (`de902c8`), no del esqueleto (`cce76e1`).
**Por qué:** cualquier PR desde ahí trae versiones paralelas de `package.json`, `tsconfig*.json` y, en el caso de GREEN, de `packages/shared-types`. Merge imposible.
**Cómo:**
```bash
git fetch origin
git checkout <tu-rama>
git rebase origin/main
# En cada conflicto de un archivo que NO es tuyo (package.json raíz, tsconfig*.json, packages/shared-types/**, .gitignore):
git checkout --theirs -- <archivo>   # durante rebase, "theirs" = tu rama; usa --ours para quedarte con main
# Regla simple: para archivos de Pablo, quédate con la versión de main:
git checkout origin/main -- package.json tsconfig.json tsconfig.base.json .gitignore
git add -A && git rebase --continue
npm install
```
**Verificar:** `git merge-base --is-ancestor origin/main HEAD && echo OK`. `npm run typecheck && npm test` en la raíz en verde.

### T2. Un solo lockfile

**Qué:** hay `package-lock.json` dentro de `apps/operator/` y `packages/tools/` (ORANGE). GREEN trae su propio lockfile raíz.
**Por qué:** npm workspaces usa un único `package-lock.json` en la raíz. Los anidados rompen `npm install` y generan diffs gigantes.
**Cómo:** `git rm apps/operator/package-lock.json packages/tools/package-lock.json` (o los que apliquen), luego `npm install` en la raíz y commitea el lockfile raíz resultante.
**Verificar:** `git ls-files | grep package-lock.json` devuelve solo `package-lock.json`.

### T3. Nombre de rama y prefijo de commit

**Qué:** GIT-RULES fija `cyan`, `magenta`, `orange`, `green` y commits `color: mensaje`.
**Cómo:** `git branch -m orange` (o `green`), `git push -u origin orange`, y borra la rama vieja en remoto: `git push origin --delete feat/orange-sandbox` (GREEN: `green/security`).

### T4. Dependencias de herramientas en la raíz

**Qué:** `tsx`, `typescript`, `@types/node`, `@types/ws` ya están en el `package.json` raíz de Pablo.
**Cómo:** quítalos de tu `apps/<tuyo>/package.json`. Deja solo lo que tu app necesita de verdad (ej. `ws`, `dockerode`, `react`). Nunca uses `"file:../../packages/x"`; usa `"@wasp/x": "*"` (workspace).

### T5. Hub en el puerto 7331, no 8787

**Qué:** ORANGE y GREEN tienen `8787` o puertos hardcodeados en README/UI.
**Cómo:** usa `WASP_HUB_URL` (default `ws://localhost:7331`) y `DEFAULT_HUB_PORT` de `@wasp/shared-types`. Busca con `git grep -n 8787` y corrige.

### T6. Tests que no rompan el runner de Pablo

**Qué:** el `npm test` raíz es `node --test "apps/**/*.test.ts" "packages/**/*.test.ts"`.
**Cómo:** si tus tests usan `node:test`, nómbralos `*.test.ts` y listo. Si usan vitest, nómbralos `*.spec.ts` y declara vitest en tu propio `package.json` (así lo hace MAGENTA). No cambies el script raíz.

---

## ORANGE — Felipe (`apps/operator`, `docker`)

### O1. Eliminar el bus propio y usar `@wasp/event-bus`

**Qué:** `apps/operator/src/bus.ts` define `Bus`, `InMemoryBus`, `WebSocketBus` y `makeEvent`. Es un segundo event bus (GIT-RULES: "Do not add a second event bus").
**Por qué:** además de duplicar, **tu `WebSocketBus` no envía `agent_registered` como primer frame**, así que el hub real responde `hub_error: first message must be agent_registered` y descarta todo lo que envíes. Hoy ORANGE no puede hablar con el hub.
**Cómo:**
1. `npm i -w @wasp/operator @wasp/event-bus@* @wasp/shared-types@*`.
2. En `main.ts`: `const hub = await connectHub({ agent: 'operator', meta: { docker: dockerAvailable } })`.
3. Sustituye `bus.publish(makeEvent(...))` por `hub.emit(type, payload, { to, correlation_id })`, `hub.say(...)`, `hub.setState(...)`, `hub.audit(...)`.
4. Para el modo `--local` sin hub, no reimplementes un bus: levanta el hub real en local con `npm run hub` y conecta a él. Si necesitas un fake para tests unitarios, haz una clase de test que implemente `Pick<HubClient, 'agent'|'onMine'|'emit'|'say'|'setState'|'audit'>` (ver `apps/researcher/tests/fakeHub.ts` como ejemplo copiable).
5. Borra `src/bus.ts`.
**Verificar:** con `npm run hub` corriendo, `npm start -w @wasp/operator` y `curl localhost:7331/agents` muestra `operator: online`. Ningún `hub_error` en el log del hub.

### O2. Eliminar `packages/tools/src/contracts.ts` (espejo de tipos)

**Qué:** tu README lo declara "local mirror of shared types → to be replaced". Ya existe el reemplazo: `packages/shared-types/src/tools.ts` (`ToolDefinition`, `ToolRequest`, `ToolResult`, `SandboxState`, `ValidationRequest`, `ValidationResult`).
**Cómo:** importa esos tipos desde `@wasp/shared-types`, borra `contracts.ts`. Si falta un campo (ej. `cpu`, `memory` para la ventana DOCKER), extiende: `interface OrangeSandboxState extends SandboxState { cpu?: string; memory?: string }` dentro de tu carpeta. Nunca redefinas el tipo base.
**Verificar:** `git grep -n "contracts" packages/tools apps/operator` vacío; `npm run typecheck` raíz en verde.

### O3. `packages/tools` no está en CODEOWNERS

**Qué:** CODEOWNERS te asigna `apps/operator/` y `docker/`. `packages/tools/` y `schemas/tools.json` no están asignados; `schemas/` es de Pablo.
**Cómo (elige una):**
- (a) Mover `packages/tools/src/*` a `apps/operator/src/tools/` (recomendado hoy: nadie más lo importa).
- (b) **PEDIR A PABLO:** añadir `/packages/tools/  # Felipe` a CODEOWNERS.
- `schemas/tools.json`: **PEDIR A PABLO** que lo integre o bórralo si `ToolDefinition.input_schema` ya cubre lo mismo.

### O4. Nombres de eventos exactos del contrato

**Qué:** el hub rechaza tipos desconocidos y emisores no autorizados (`apps/hub/src/authority.ts`).
**Cómo:** usa exactamente: `tools_registered` (al conectar), `sandbox_state`, `sandbox_started`, `sandbox_test`, `sandbox_result`, `tool_requested`, `tool_started`, `tool_finished`, `validation_result`. Escucha `validation_request` con `hub.onMine`. Para permisos: `hub.request('permission_requested', req, { to: 'security', expect: ['permission_granted','permission_denied','permission_cancelled'] })` y **no ejecutes nada hasta recibir `permission_granted`**. Si lanza `AgentUnavailableError`, di que GREEN está offline, no continúes.
**Verificar:** `git grep -n -o -E "emit\('[a-z_]+'" apps/operator | sort -u` y compara con `EVENT_TYPES` en `packages/shared-types/src/events.ts`.

### O5. Docker offline es un estado, no un error

**Qué:** CONTEXT.md §20. Si Docker no está, `sandbox_state { available: false, status: 'OFFLINE', message }` y `validation_result { validated: false, tests: [], summary: 'Docker capability is unavailable...' }`.
**Verificar:** con Docker Desktop apagado, `npm run smoke`-equivalente de ORANGE termina con `validated: false` y la cara en `ERROR`/`WARNING`, nunca `SUCCESS`.

### O6. UI

**Qué:** `ui-server.ts` es un relay local de solo lectura. Funciona, pero cada agente con su relay son cuatro relays.
**Propuesta:** conecta la UI directamente al hub con `HubClient({ agent: 'operator', meta: { role: 'ui' } })` (el hub mantiene al agente online mientras quede algún socket). Es lo que hace MAGENTA en `apps/researcher/src/ui/hooks/useHub.ts`. Opcional hoy; obligatorio si Pablo lo confirma como convención.

---

## GREEN — Juanda (`apps/security`, `packages/permissions`)

### G1. Borrar tu `packages/shared-types` y usar el de Pablo — **BLOQUEANTE**

**Qué:** tu rama reescribe los 8 archivos de `packages/shared-types`, más `tsconfig.base.json`, `tsconfig.json`, `package.json` raíz, `.gitignore` y añade `vitest.config.ts`. Todos son de Pablo (CODEOWNERS).
**Por qué:** el merge destruiría el contrato que CYAN y MAGENTA ya usan. Y tus imports con extensión (`from './agents.ts'`) no compilan con el `tsconfig.base.json` de Pablo (no tiene `allowImportingTsExtensions`).
**Cómo:**
```bash
git rebase origin/main   # ver T1
git checkout origin/main -- packages/shared-types package.json tsconfig.json tsconfig.base.json .gitignore
git rm -q vitest.config.ts
# tus tipos de permisos van a TU paquete:
git mv packages/shared-types/src/permissions.ts packages/permissions/src/types.ts   # solo si quedó algo tuyo; si no, bórralo
```
Luego, en `packages/permissions` y `packages/audit`: importa `PermissionRequest`, `PermissionEvaluation`, `PermissionDecision`, `HumanAuthorization`, `RiskLevel`, `AuditEntry` desde `@wasp/shared-types`. Lo que no exista allí (`SecurityEvaluation`, `VoiceDecision`, políticas) vive en `packages/permissions/src/types.ts` y **extiende** los tipos compartidos.
Quita las extensiones `.ts` de todos los imports: `sed -i "s/from '\(\.\.\?\/[^']*\)\.ts'/from '\1'/g" $(git ls-files 'packages/permissions/**/*.ts' 'packages/audit/**/*.ts' 'apps/security/**/*.ts')`.
**Verificar:** `git diff --name-only origin/main -- packages/shared-types package.json tsconfig.base.json tsconfig.json` vacío. `npm run typecheck` raíz en verde.

### G2. Nombres de eventos: mapear a los del contrato

**Qué:** emites `agent_state_changed`, `permission_expired`, `permission_reprompt`, `permission_prompt`, `permission_auto`, `security_evaluated`, `tool_blocked`. El hub solo acepta `EVENT_TYPES`; el resto se descarta.
**Cómo (mapa):**
| tuyo | contrato |
|---|---|
| `agent_state_changed` | `agent_state` (usa `hub.setState`) |
| `permission_prompt` / `security_evaluated` | `permission_required` con `PermissionEvaluation { permission_id, operation, risk, approval_required, human_prompt }` |
| `permission_reprompt` | `permission_clarification_needed { permission_id, human_prompt }` |
| `permission_auto` | `permission_granted` con `decided_by: 'security'` (o el campo equivalente de `PermissionDecision`) |
| `permission_expired` | `permission_cancelled` con `reason: 'timeout'` |
| `tool_blocked` | `permission_denied` + `audit_event { status: 'denied' }` |
Si crees que alguno merece existir como evento propio (ej. `permission_expired`), **PEDIR A PABLO** con el payload exacto; él lo añade a `EventPayloads`, `EVENT_TYPES` y `authority.ts`.
**Verificar:** `git grep -n -o -E "'(permission|security|tool|agent)_[a-z_]+'" packages/permissions/src | sed 's/.*://' | sort -u` es subconjunto de `EVENT_TYPES`.

### G3. Conectar GREEN de verdad al hub

**Qué:** `apps/security/src/demo.ts` y `serve-ui.ts` no se conectan al hub; `LocalEventBus` es solo de test.
**Cómo:** crea `apps/security/src/main.ts`:
```ts
const hub = await connectHub({ agent: 'security' });
hub.setState('MONITORING');
hub.onMine('permission_requested', async (evt) => { /* evaluar → hub.emit('permission_required', ..., { to: 'architect', correlation_id: evt.payload.permission_id }) */ });
hub.on('user_authorization', (evt) => { /* YES/NO/STOP/AMBIGUOUS → permission_granted | permission_denied | permission_cancelled | permission_clarification_needed */ });
hub.onAny((evt) => { /* audit_event para lo relevante; hub ya persiste a audit/<session>.jsonl */ });
```
Mantén `LocalEventBus` solo bajo `src/testing/` y no lo exportes desde `index.ts` (o hazlo como `export * as testing`), para que nadie lo use en producción.
**Verificar:** `npm run hub` + `npm run stubs -- operator` + tu `main.ts`: el stub de operator pide permiso, GREEN responde `permission_required`, y con `WASP_AUTO_ANSWER=yes npm run architect -- "..."` el flujo termina en `permission_granted`. `curl localhost:7331/context | jq .permissions` no está vacío.

### G4. `packages/audit` no está en CODEOWNERS

**Qué:** CODEOWNERS te da `apps/security/` y `packages/permissions/`. `packages/audit/` no figura.
**Cómo:** o lo mueves a `packages/permissions/src/audit/`, o **PEDIR A PABLO**: `/packages/audit/  # Juanda`. Ojo: el hub ya persiste `audit_event` a disco; tu `audit-log.ts` debe consumir el stream, no ser otra fuente de verdad. Tu `validation-guard.ts` es valioso: proponlo como test adversarial contra el reducer de Pablo (`apps/hub/src/reducer.test.ts` ya tiene "lab validated only from real operator").

### G5. UI de GREEN

**Qué:** `apps/security/ui/index.html` conecta con `?hub=ws://localhost:8787` y parsea `WaspEvent` a mano.
**Cómo:** default `7331` (T5). Mejor: usa `HubClient({ agent: 'security', meta: { role: 'ui' } })` desde un bundler, o al menos manda `agent_registered` como primer frame, si no el hub cierra la conexión con `hub_error`.

### G6. Adversarial: tres pruebas que ya puedes escribir contra el sistema real

1. Docker apagado → `workshop.lab.validated` sigue `false` (reducer de Pablo ya lo garantiza; escribe el test end-to-end).
2. Página envenenada → MAGENTA emite `warning` y `research_result.results[i].warnings[]` (ver `apps/researcher/tests/agent.spec.ts` "flags prompt injection").
3. Voz ambigua ("maybe", "do what you think") → `permission_clarification_needed`, nunca `permission_granted`.

---

## CYAN — Pablo (`apps/hub`, `apps/architect`, `packages/shared-types`, `packages/event-bus`)

Pedidos pequeños, todos compatibles hacia atrás. Cada uno es un PR de pocas líneas.

### C1. Campos opcionales en `research.ts`

```ts
// ResearchResult
warnings?: string[];      // e.g. "possible prompt injection in source"
retrieved_at?: string;    // ISO-8601
// ResearchSummary
mode?: 'web' | 'catalog';
degraded?: boolean;
degraded_reason?: string;
official_count?: number;
```
MAGENTA ya los emite; hoy viajan sin tipo. Ver `apps/researcher/src/research/types.ts`.

### C2. Transición FOUND → VERIFIED en el reducer

**Qué:** no hay regla que marque `research[i].verification_status = 'VERIFIED'`.
**Propuesta:** en `ValidationResult`/`ToolResult` añadir `verifies_research_ids?: string[]`. En `reduce()` para `validation_result` de `operator` no stub con `validated: true`: para cada id, `research[i].verification_status = 'VERIFIED'`. Test: un stub no puede verificar.

### C3. CODEOWNERS

Añadir `/packages/tools/  # Felipe` (o pedirle que lo mueva a `apps/operator`), `/packages/audit/  # Juanda`, y `/docs/RESEARCH.md /docs/CORRECCIONES.md  # Andrea`.

### C4. Convención de UI como visor

Documentar en `CONTRACT.md` §2: "Una UI se conecta como su agente con `meta: { role: 'ui' }`. El hub mantiene al agente online mientras quede algún socket (ya implementado en `handleClose`). Las UIs no emiten eventos de dominio; solo `tts_*`." Opcional: que el reducer no sobreescriba `agents[x].meta` cuando `meta.role === 'ui'`, para que `meta.docker`/`research_mode` del proceso real no se pierda.

### C5. Log de arranque del hub

Imprimir una línea estable tipo `hub listening on ws://0.0.0.0:7331` al escuchar. Los smoke tests de los demás la usan como marcador de "listo" (MAGENTA hoy hace polling a `/health` como respaldo).

### C6. `agent_finished` en el reducer

MAGENTA emite `agent_finished { agent, summary }` al terminar. Hoy el reducer lo ignora (correcto), pero podría poner `agent_states[agent] = 'COMPLETE'` si no llegó `agent_state`, o añadirlo a `decisions`. Baja prioridad.

### C7. Eventos que GREEN necesita (ver G2)

Si Juanda justifica `permission_expired` como evento propio, añadirlo con `authority: ['security']`. Si no, `permission_cancelled { reason: 'timeout' }` basta.

---

## MAGENTA — Andrea (`apps/researcher`, `packages/voice`, `packages/ui`)

Autocorrecciones pendientes:

### M1. Ocultar el botón "SIMULATE CYAN REQUEST" cuando CYAN esté online
`useHub` ya expone `context.agents.architect.status`; renderizar el botón solo si `!== 'online'` o detrás de `?dev=1`.

### M2. Extraer `packages/ui` y `packages/voice`
`AgentFace.tsx` + `FloatingWindow.tsx` + `styles.css` (tokens por color) → `packages/ui`. `tts.ts` + un productor de `stt_transcript` (Web Speech `SpeechRecognition`) para la PC de CYAN → `packages/voice`. Ambos con `package.json` `"@wasp/ui"` / `"@wasp/voice"` y `main: ./src/index.ts` como hace Pablo. Sin `.tsx` fuera de `packages/ui` para no romper el `typecheck` raíz (`apps/**/*.ts`).

### M3. Credenciales para la demo
Exportar `ANTHROPIC_API_KEY` en la PC MAGENTA y probar una vez el modo `web` contra la API real (hoy solo probado con cliente simulado). Si la API falla en vivo, el catálogo entra solo y la voz lo dice.

### M4. Reducir la línea hablada
`summary.summary` tiene tres frases. Para TTS conviene una: dejar `summary` completo en el payload y pasar a `hub.say` solo la primera frase + "documented but not validated". Detalle en pantalla.

---

## Orden recomendado de merge (actualiza GIT-RULES §"Merge order")

1. `magenta` → main (ya rebasada, typecheck/tests raíz en verde, smoke contra el hub real pasa). Desbloquea a CYAN para orquestar con research real.
2. Pablo aplica C1, C3, C4, C5 (10 minutos).
3. `orange` tras O1–O4. Sin O1 el operador no habla con el hub.
4. `green` tras G1–G3. Sin G1 no se puede mergear nada de GREEN.
5. `packages/ui` + `packages/voice` (Andrea) → los tres importan la cara.
6. Ensayo completo con los cuatro procesos reales; congelar `main` una hora antes.

## Checklist de PR (pegar en la descripción)

- [ ] Rebasado sobre `origin/main` hoy
- [ ] Solo toca mis carpetas de CODEOWNERS (+ `package-lock.json` raíz si añadí deps)
- [ ] Sin bus/hub client/tipos compartidos propios
- [ ] Emite solo tipos de `EVENT_TYPES` y solo los que `authority.ts` me permite
- [ ] `npm run typecheck && npm test` en la raíz en verde
- [ ] Probado contra `npm run hub` real, sin `hub_error` en el log
- [ ] Nunca reporta éxito sin evidencia real (Docker offline, API offline, agente offline)
