# apps/researcher — 🩷 MAGENTA (Andrea)

Real implementation of the researcher agent, its UI and MAGENTA voice. Full docs: [`docs/RESEARCH.md`](../../docs/RESEARCH.md).

```bash
npm run agent -w @wasp/researcher     # agent process → needs Pablo's hub (WASP_HUB_URL)
npm run dev   -w @wasp/researcher     # face + windows on http://localhost:5174
npm test      -w @wasp/researcher     # unit tests (vitest)
npm run smoke -w @wasp/researcher     # boots hub + agent, runs the CYAN→MAGENTA flow end to end
```

Contract: `docs/CONTRACT.md`. This folder only extends the shared types, never redefines them.
Web content is untrusted data. MAGENTA never emits `VERIFIED`.
