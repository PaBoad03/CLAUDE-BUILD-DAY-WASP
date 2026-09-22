# apps/security — 🟢 GREEN (Juanda)

The GREEN agent process: connects to the WASP HUB as `security`, runs the permission engine
from `@wasp/permissions`, keeps a local audit view (`@wasp/audit`) and serves the GREEN face.

```bash
npm run security                                   # Pablo's PC (hub on localhost)
WASP_HUB_URL=ws://<pablo-ip>:7331 npm run security   # Juanda's PC
npm test -w @wasp/permissions && npm test -w @wasp/audit
```

GREEN face: http://localhost:7004 — SECURITY REVIEW window with SÍ / NO / STOP buttons
(they enter WASP as `user_authorization` from `human` through the hub's HTTP bridge),
AGENT COMMUNICATION, PERMISSIONS and AUDIT windows fed by the shared context.

Full design, guarantees and integration notes: `docs/GREEN.md`.

Solo rehearsal on one PC:
`npm run hub` · `npm run stubs -- researcher operator` · `npm run security` · `npm run architect`
