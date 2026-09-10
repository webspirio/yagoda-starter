# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Web Starter — a production-ready web application boilerplate with a NestJS backend, React frontend, PostgreSQL, and Redis.

## Collaboration workflow

`superpowers:using-superpowers` loads at session start and sets the baseline rule: **if there's any chance a skill applies, invoke it before acting** — before clarifying questions, before exploring code. This project layers a specific order on top:

1. **Plan first.** Start every non-trivial task with `/grilling` to stress-test the idea, then `superpowers:brainstorming` to shape requirements and design.
2. **Then implement** via `/superpowers` — `writing-plans` → `executing-plans` / `subagent-driven-development`, with `test-driven-development`, `systematic-debugging`, and `requesting-code-review` applied as you go.
3. **Process skills before implementation skills.** A planning or debugging skill sets the approach; the domain skills below carry it out.

## Skills

| When the task involves… | Invoke |
|---|---|
| Stress-testing a plan before building, or any "grill" phrasing | `grilling` |
| Any new feature, component, or behavior change — before writing code | `superpowers:brainstorming`, then the `superpowers:*` implementation skills |
| **Backend** (`backend/src`) — writing/reviewing/refactoring a Nest module | `nest-module-conventions` |
| **Backend** — NestJS architecture: DI, module boundaries, security, performance | `nestjs-best-practices` |
| **Frontend** (`frontend/src`) — where code belongs: FSD layers, slices, public APIs | `feature-sliced-design` |
| **Frontend** — adding, composing, styling, or debugging shadcn/ui components | `shadcn` (model-invoked automatically) |

## Repository structure

| Path | Purpose |
|------|---------|
| `backend/` | NestJS API — see `backend/CLAUDE.md` |
| `frontend/` | React SPA — see `frontend/CLAUDE.md` |
| `nginx/` | Production reverse proxy (nginx config + Dockerfile) |
| `docker-compose.yml` | Local dev stack (postgres, redis, backend, frontend) |
| `docker-compose.prod.yml` | Production stack (postgres, redis, backend, nginx) |
| `.env` | Local secrets — not committed; copy from `.env.example` |

## Commands

```bash
docker compose up          # start full dev stack
docker compose logs -f     # stream logs
npm test                   # both workspaces
npm run lint
npm run build
npm run db:seed             # idempotent demo dataset for manual testing — see backend/CLAUDE.md «Dev seed»
```

## Verification

The gate a turn is checked against — `npm run verify` — runs the **fast tier only**:
`lint`, `typecheck`, `test`, `memo`. There is no `build`, no `smoke`, and no `coverage` row
in it, so a turn can end green having never built the app. `typecheck` *is* in the fast
tier, so a type error is caught; what stays uncovered is exactly what breaks only in a Vite
production build or only inside the Docker image — `npm run verify:full` is what reaches
those, once the rows that cover them exist.

Three commands, with their measured cost on this machine (2026-09-10):

```bash
npm run verify        # fast tier — lint, typecheck, test, memo. Cold, e.g. right after a
                       # clone or a turbo-cache wipe: 52.0s — a once-per-clone cost, not a
                       # per-turn one. The everyday range, one edit then a re-run, is
                       # 12.7s (backend-only edit) to 32.3s (frontend-only edit); with
                       # nothing changed since the last run, 1.1s. The frontend half is
                       # the expensive one: vitest builds 99 jsdom environments per run,
                       # and that setup dominates. Changing vitest's isolation model to
                       # cut that cost is deliberately out of scope for this PR.
npm run verify:full   # the fast tier plus everything that needs a build, a browser, a
                       # database or a registry
npm run verify:ci     # verify:full with --no-skip — a missing precondition is a failure
                       # here, not a quietly narrower green
```

`node scripts/verify/run.mjs --tier fast --reuse-if-fresh` against an already-green report
for the same source hash costs 0.05s: it prints the same blind-spot footer without
re-running anything.

Every one of those checks is an ordinary npm script that runs standalone, unchanged,
outside the orchestrator: `npm run lint`, `npm run typecheck`, `npm test`, and
`node scripts/verify/checks/memo-drift.mjs` all run directly, from the command line, with
no orchestrator involved. Nothing exists only inside `scripts/verify/run.mjs`, and nothing
exists only inside CI — CI runs the identical command a laptop runs.

| status | meaning | blocks |
| --- | --- | --- |
| `PASSED` | ran, passed | no |
| `FAILED` | ran, failed | yes |
| `SKIPPED` | a precondition was absent — there was nowhere to run | no, but it must be said out loud |
| `NOT_RUN` | a dependency did not pass, so this was never attempted | yes |
| `UNRUNNABLE` | the command could not start (127 / spawn error) | yes |

`UNRUNNABLE` is not pedantry. Reporting "lint FAILED" when the linter is merely absent from
`PATH` asserts something about the code that nobody tested.

<!-- BEGIN:verify-table -->
<!-- Generated from scripts/verify/registry.mjs. Do not hand-edit:
     the `memo` check compares this block byte for byte and fails on any divergence.
     To change the text, edit registry.mjs, then run
     `node scripts/verify/checks/memo-drift.mjs --write`. -->

| check | tier | proves | does NOT prove |
| --- | --- | --- | --- |
| `lint` | fast | eslint parsed every file its flat config reaches in both workspaces (backend/eslint.config.mjs, frontend/eslint.config.mjs) and reported zero findings at either severity — no parse failure, no rule violation at error severity, and, because both lint scripts now pass --max-warnings=0, no warning either: react-hooks/exhaustive-deps and react-refresh/only-export-components, both configured at warn, are exactly as blocking here as an error-level rule. That includes the money-arithmetic ban scoped to backend/src/intakes, src/payouts, src/shifts and src/supplier-balance, which forbids *, /, Number(), toFixed, parseInt and parseFloat there (test files in those four trees are excluded by the same config). | Nothing about behaviour: whether a sum is right, whether a component renders. A rule that is not enabled does not exist for it, and the money ban covers exactly FOUR backend module trees — arithmetic on a numeric string anywhere else (every other backend module, and the whole of frontend/src) is invisible to this row. |
| `typecheck` | fast | tsc reports zero type errors across every project the typecheck command spans: backend (tsc -p tsconfig.json --noEmit, strict mode, over everything under backend/src including *.spec.ts and *.db-spec.ts — there are no backend .ts files outside src/), frontend (tsc -b, building tsconfig.app.json over src/ and tsconfig.node.json over vite.config.ts), and the verify layer itself (tsc -p tsconfig.scripts.json, checkJs, over scripts/**/*.mjs and .claude/hooks/**/*.mjs). A type error in any one of those three projects fails this exact command. | Nothing about runtime data: a field typed as a plain string accepts any string tsc never inspects the value of, and every `as` cast and non-null assertion (`!`) is a hole this row does not look through. JSON parsed from a database row, an HTTP body or a JWT payload is trusted at the type boundary, not verified. And its reach is exactly the three tsconfig files above: a file none of their include/exclude rules reaches is not type-checked by this row at all. |
| `test` | fast | Measured 2026-09-10: backend jest (NODE_OPTIONS=--experimental-vm-modules jest, testRegex .*\.spec\.ts$, rootDir src) ran 40 suites / 511 tests, and frontend vitest (vitest run) ran 99 files / 592 tests — 139 files and 1103 tests total, all passing. A single failing assertion anywhere in either workspace turns this exact command, and this row, red. | The backend testRegex matches only *.spec.ts, so all 12 *.db-spec.ts suites (backend/jest.db.config.js, a separate config) are excluded from this row entirely — test:db is what covers those. No .tsx file is exercised by the backend suites: the backend has no .tsx files, and only the frontend vitest half of this row ever touches one. And this row cannot see assertion strength: a test that calls a function and asserts nothing about the result is exactly as green as one that checks the answer. |
| `memo` | fast | The generated table region in the root CLAUDE.md, delimited by its verify-table HTML comment markers, is byte-for-byte identical to what scripts/verify/checks/memo-drift.mjs renders from this exact CHECKS array right now, down to the trailing registry-checksum comment — a hand edit on either side, in either direction, fails this exact command. | Nothing about whether a proves or blindSpot string is itself true of its check — only that the table quotes the registry's current values verbatim. And its reach is exactly the marked block: prose elsewhere in CLAUDE.md, including the rest of this Verification section, can drift from reality with this row staying green. |
| `testfiles` | fast | Measured 2026-09-10: every one of the 156 files in this repo whose name matches *.{test,spec,db-spec}.[cm]?[jt]sx? is collected by exactly one of this repo's four test runners — jest-unit (40 files, backend/package.json's testRegex, rootDir src), jest-db (12 files, backend/jest.db.config.js's separate testRegex, also rootDir src), vitest (99 files, frontend's default include, no test.include set) and node-test (5 files, scripts/**/*.test.mjs, run by npm run test:verify). The two backend regexes are read out of backend/package.json and backend/jest.db.config.js at runtime, not copied here, so this row also proves those two files still say what the check assumes — a file with zero matching collectors, or claimed by two at once, fails this exact command. | Nothing about the tests themselves: a file collected by exactly one runner can still assert nothing, or assert the wrong thing — this row only proves each candidate file is picked up once, never that it runs correctly, or at all, once collected. Its candidate pattern is *.{test,spec,db-spec}.* in the [cm]?[jt]sx? extensions; a file that looks like a test under any other name is invisible to it on both sides — reported as neither an orphan nor a false double-collection. And it knows only the four runners this repo has today; a fifth collector added later is unseen by this row until this row is taught about it. |
| `secrets` | fast | This repo's actual credentials — JWT_SECRET and DB_PASSWORD, which live only in the untracked root .env, CI supplying its own throwaway values inline — stay out of git on four fronts. (1) `git ls-files -- .env .env.*`, run at the repo root, returns nothing but .env.example. (2) The three root .gitignore lines that make that true (.env, .env.*, !.env.example) are SHA-256-fingerprinted in scripts/verify/baselines/secret-boundary.json, dated 2026-09-10 — editing, reordering or removing any one of them without a matching baseline update, in the same reviewed commit, fails this exact command. (3) Every file `git ls-files` tracks (skipping package-lock.json and the baseline file itself) is scanned line by line for a PEM BEGIN…PRIVATE KEY block, a JWT-shaped string (eyJ + two more .-separated base64url segments), and a ≥32-character contiguous alphanumeric run with Shannon entropy over 3.5 bits/char assigned to a name matching /secret\|password\|token\|api[_-]?key/i. (4) Every value in .env.example is additionally held to a placeholder-only standard — empty, a changeme/example/your-/<...>/... shape, or short and low-entropy on its own merits, regardless of what its key is named — on top of, not instead of, check (3). A single tracked file failing any of the four fails this exact command; a real secret is never written into the baseline, which holds only the gitignore fingerprint. | Shannon entropy is a heuristic wrong in both directions: a dense natural-language placeholder can cross the threshold (this repo's own JWT_SECRET example value scores 3.7 bits/char over its full length, saved only because no single hyphen-free word in it reaches 32 characters — a deliberate, narrow rule, not a general defence), and a short or structured real secret can stay under it entirely — nothing below 32 contiguous letters-and-digits is ever inspected. A secret containing `-` or `_` (many real API keys and JWTs do) is invisible to the entropy sub-check for the same reason. Inside a .md file, a match wrapped in a single backtick span is treated as a quoted example and skipped, so a real secret pasted into a markdown code span would not be caught. This check also sees only files `git ls-files` tracks RIGHT NOW, at the CURRENT commit — a credential committed and later deleted is invisible to it, history is never searched, and rule 1's pathspec is root-anchored, not recursive, so an errant .env committed inside backend/ or frontend/ would not be named by it either. And it cannot tell a real credential from a convincing fake: this very check's own tests plant a fake PEM header and a JWT built from the literal string "not-a-real-token", and both are exactly as red as the genuine article — the shape is all this check ever sees. |

<!-- registry-checksum: f4a528409b0fc1e3529230f67013fc29 -->
<!-- END:verify-table -->

The table above is generated from `scripts/verify/registry.mjs`, not written by hand — see
the header comment inside the markers for how to regenerate it. Three rules keep it, and
the rest of this contract, honest:

1. **Evidence under the claim.** What changed decides what must be run, not habit:

   | change | run |
   | --- | --- |
   | anything in `backend/src` or `frontend/src` | `npm run verify` |
   | anything touching money | `npm run verify`, and name the coverage number |
   | `package.json` or the lockfile | `npm run verify:full` — that is where `audit`, `bundle` and `deadcode` live |
   | a migration | `npm run verify:full` — that is where `test:db` lives |
   | `scripts/verify/` or `.claude/hooks/` | `npm run verify` — that code is under `tsconfig.scripts.json` too |
   | the registry (`scripts/verify/registry.mjs`) | `node scripts/verify/checks/memo-drift.mjs --write`, or `memo` goes red |

2. **Skips are spoken aloud.** "The fast tier is green; `smoke` and `docker` were skipped,
   no daemon" — never "all green". A `SKIPPED` row is a row nobody ran, not a row that
   passed.

3. **Ratchets turn one way.** Widening a baseline, relaxing a rule, adding a knip
   suppression key, or lowering a coverage floor **is not turning green** — it is the
   cheapest available response to a red check, and it is exactly what this layer exists to
   catch. An exception is allowed only when it is listed individually, dated, carries a
   reason checked against the source, and cancels itself the moment the finding it excuses
   disappears.

## Architecture

- **API:** frontend → nginx `location /api/` (prefix stripped via `proxy_pass` trailing slash) → backend on port 3000. In dev the frontend calls the backend directly (`VITE_API_URL`); there is no Nest global prefix.
- **Auth:** login + password. The backend verifies credentials and issues a JWT (HS256, 7 days, payload `{ sub }` and nothing else) that the frontend keeps in `localStorage`. `JwtStrategy.validate()` reloads the user row on every authenticated request, so deactivation, demotion and point reassignment take effect on that user's very next request — there is no refresh token, but there is real revocation. Two roles, `network_owner` and `point_operator`: `@Auth()` means "any authenticated user", `@Auth(UserRole.NetworkOwner)` means owner only. There is no public registration — `POST /auth/login` is the only public route; a `network_owner` creates accounts via `POST /users`.
- **Identity seam:** `user_identities(provider, provider_user_id)` is the single login lookup path. This starter writes `provider = 'local'`; adding an OAuth provider means writing a different value, with no schema change.
- **Domain:** the schema of record is `28-db-schema.dbml` (repo root), and the business rules it cites live in `26-rules-by-example.md` (repo root, `§N` references throughout the code point there). Implemented so far: `users`, `collection_points` (foundation slice), `products`, `product_grades`, `tare_types` (catalog slice), `suppliers`, `grade_prices` (prices slice), `shifts`, `intakes`, `intake_items`, `intake_item_tare_types`, `payouts` (this slice). Five tables remain, all of them cash and crates: `crate_issuances`, `crate_returns`, `crate_return_allocations`, `cash_counts`, `transfers`. Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`, and open follow-ups in `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`.
- **Data:** PostgreSQL via TypeORM — `synchronize: false`, migrations run automatically on startup.
- **Documents:** `shifts` is one point's working day and the ONLY place `intakes` and `payouts` learn their point and business date — neither stores those columns, so scoping a query to a point is a JOIN. A document is never edited: §2.7 freezes `amount` and §9.3 makes a correction a void plus a new document, so there is no `PATCH` on either table. An operator may void only a document they recorded themselves and only while the shift is open (§9.4); the owner may void anything. Opening and closing a shift is the operator's alone (§10.3); reopening is the owner's.
- **Money:** every arithmetic operation on a `numeric` value goes through `backend/src/common/money.ts` — strings in, strings out, half-up at 2 decimals, rounded per line then summed. An eslint rule bans `*`, `/`, `Number()` and `toFixed` in the four modules that handle money. `decimal.js` is deliberately not a dependency yet.
- **Redis:** rate-limit counters only; no durable state.
- **Health:** `GET /health/live` (process) and `GET /health/ready` (DB + Redis); compose healthchecks gate on `/health/ready`.

## Deployment

`nginx/` is a pure internal reverse proxy between the frontend static assets and the backend API — it does not terminate TLS. In `docker-compose.prod.yml`, `nginx` listens only on `127.0.0.1:8080` (plain HTTP); it expects a host-level reverse proxy or load balancer that owns the public HTTPS listener and forwards to `127.0.0.1:8080`. That terminator must allow request bodies of at least ~12 MB (`client_max_body_size`; nginx defaults to 1 MB): the app accepts image uploads up to 10 MB, and a smaller limit returns 413 before the request ever reaches the app (see `docs/vps-tls-setup.md`).
