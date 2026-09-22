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
2. Each agent's minimal real connection (registers, sets face state, answers its request type) → PR.
3. Voice + UI packages (Andrea) → PR; others import.
4. Docker + real tests (Felipe) → PR.
5. Permission engine + audit + adversarial tests (Juanda) → PR.
6. Claude API orchestration (Pablo) → PR.
7. Polish, demo rehearsal, freeze `main` one hour before the demo.
