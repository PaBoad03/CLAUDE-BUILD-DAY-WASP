# WASP — Git rules for four Claude Codes on one repo

Four people, four Claude Code sessions, one `main`, a few hours. These rules exist so nobody steps on anyone.

## Branches

| Person | Agent | Branch |
|---|---|---|
| Pablo | CYAN | `cyan` |
| Andrea | MAGENTA | `magenta` |
| Felipe | ORANGE | `orange` |
| Juanda | GREEN | `green` |

- Nobody commits directly to `main` after the skeleton. Work on your branch, merge via PR (or ask Pablo to merge).
- Before every push: `git fetch origin && git rebase origin/main`. Small conflicts now beat a giant one at 5pm.
- Push often. A branch that has not been pushed for an hour is invisible to the team.

## Folders

Write **only** inside your folders (see `CODEOWNERS`):

- Pablo: `apps/hub`, `apps/architect`, `packages/shared-types`, `packages/event-bus`, `schemas`, `docs/CONTRACT.md`, root config.
- Andrea: `apps/researcher`, `packages/voice`, `packages/ui`.
- Felipe: `apps/operator`, `docker`.
- Juanda: `apps/security`, `packages/permissions`.

Need something in a folder you don't own? Ask the owner in person or open a **tiny** PR touching only that. Never edit it silently in your feature branch.

## Do not

- Do not rename, move, or reformat files you don't own. This is the #1 cause of merge conflicts.
- Do not add a second event bus, context store, hub client, or schema folder. Use `@wasp/event-bus` and `@wasp/shared-types`.
- Do not commit `.env`, API keys, `node_modules`, or `audit/*.jsonl`.
- Do not change root `package.json` dependencies without telling Pablo. Add deps to **your own** `apps/<you>/package.json`.
- Do not `git push --force` to `main`. Ever.

## Do

- Commit messages: `cyan: hub reducer for permissions`, `orange: docker availability check`. Prefix with your color.
- Run `npm run typecheck && npm test` before pushing. If it is red on `main`, fix it or ping the owner immediately.
- If you need a new event type or field: say what, why, and the payload shape. Pablo adds it in minutes.
- If your agent is not ready yet, run its stub (`npm run stubs -- <agent>`) so the others can still demo.

## Merge order for today

1. Skeleton + contract (Pablo) → `main`. **Done.**
2. Each agent's minimal real connection (registers, sets face state, answers its request type). **Done 2026-09-22:** `magenta`, `feat/orange-sandbox` and `green/security` merged into `main` (ORANGE and GREEN rewired onto `@wasp/event-bus` + `@wasp/shared-types`; see `docs/CONTRACT.md` §9 and `docs/CORRECCIONES.md`). The old branches are obsolete: **branch again from `main`**.
3. Voice + UI packages (`packages/voice`, `packages/ui`). **Done 2026-09-22:** extracted from MAGENTA's UI; MAGENTA and CYAN faces import them (ORANGE/GREEN faces are plain HTML viewers for now).
4. Claude API orchestration in `apps/architect`. **Done 2026-09-22:** `src/orchestrator.ts`; needs `ANTHROPIC_API_KEY` on Pablo's PC — the first live run against the real API is still pending.
5. Real Docker rehearsal on Felipe's PC (`npm run operator -- --build`, then `npm run operator`).
6. Polish, demo rehearsal with four real processes + the CYAN face mic, freeze `main` one hour before the demo.

Since step 2, every agent has a root script: `npm run hub | architect | researcher | operator | security`, and `npm run stubs -- <agent>` for whoever is missing. `npm test` runs every package (node:test); MAGENTA's vitest suite: `npm test -w @wasp/researcher`.
