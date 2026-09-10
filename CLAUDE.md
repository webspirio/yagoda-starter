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

The gate a turn is checked against — `npm run verify` — runs the **fast tier only**. There
is no `build`, no `smoke`, and no `coverage` row in it, so a turn can end green having never
built the app. `typecheck` *is* in the fast tier, so a type error is caught; what stays
uncovered is exactly what breaks only in a Vite production build or only inside the Docker
image — `npm run verify:full` is what reaches those, once the rows that cover them exist.
For the exact current list — it grows as rows are added, most recently `selfcheck` — see the
generated table below rather than a count repeated here, which would only go stale again.

Three commands. The cost figures below are a SNAPSHOT, MEASURED 2026-09-10 at commit
`292b99b` (nine fast-tier rows, all of them `tier: 'fast'` — there is no `full` row yet) —
they will drift as more rows land (four more checks are planned after this one) and MUST be
re-measured rather than assumed once they look suspicious. To re-measure: edit a file with
content turbo has never hashed before. Turbo caches by content hash, so re-applying the
SAME edit text used in an earlier measurement silently replays that run's cached result and
reports a falsely fast number — this is exactly how an earlier version of this snapshot
(12.7s / 32.3s / 1.1s) understated the true cost, in one case by more than 10x. Use a
fresh, unique probe (e.g. append a one-off timestamped comment) every time you measure.

A genuine COLD number (empty turbo cache) is deliberately NOT given below. This worktree's
turbo cache lives at `/home/dz/work/yagoda-starter/.turbo` — the MAIN checkout's root, not
this worktree — and is therefore SHARED with every other worktree of this repository,
several of which hold unrelated open work. Wiping it to get a true cold reading would
destroy cache state other branches depend on, so don't: measuring "cold" locally in a
worktree never actually is, and a `rm -rf` there is a shared-state footgun, not a
measurement technique.

```bash
npm run verify        # fast tier, all nine rows. MEASURED 2026-09-10 @ 292b99b:
                       #   turbo tasks, cache bypassed (not wiped — see above):
                       #     `npx turbo lint typecheck test --force`        31.9s
                       #   backend-only edit:          ~22.0s  (lint 1.8s / typecheck 1.8s /
                       #                                test 7.7s / selfcheck 9.5s / rest ~1.2s)
                       #   frontend-only edit:         ~38.4s  (lint 4.8s / typecheck 4.4s /
                       #                                test 17.7s / selfcheck 10.2s / rest ~1.3s)
                       #   warm, nothing changed:      ~11.9s
                       # The frontend edit is the expensive path: vitest builds 99 jsdom
                       # environments per run. `selfcheck` (node --test, 70 tests) adds a
                       # second near-fixed ~9.5-10s on top of that, regardless of what
                       # changed — visible in every row above, and alone enough to explain
                       # why "warm, nothing changed" is ~11.9s rather than near-zero. Cutting
                       # either cost is deliberately out of scope here. A truly cold
                       # `npm run verify` (empty cache) is NOT measured here — see above —
                       # but ARITHMETIC over two real measurements (31.9s turbo-forced +
                       # ~9.5-10s selfcheck + ~1.2s for the five remaining non-turbo rows,
                       # from the backend-only breakdown) puts it in the neighbourhood of
                       # 42-43s. That is a sum, not a measurement — do not quote it as one.
npm run verify:full   # the fast tier plus everything that needs a build, a browser, a
                       # database or a registry
npm run verify:ci     # verify:full with --no-skip — a missing precondition is a failure
                       # here, not a quietly narrower green
```

`node scripts/verify/run.mjs --tier fast --reuse-if-fresh` against an already-green report
for the same source hash costs about 0.05s (re-measured 2026-09-10 alongside the figures
above: 0.047s): it prints the same blind-spot footer without re-running anything.

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
| `test` | fast | A SNAPSHOT, MEASURED 2026-09-10 (see CLAUDE.md's Verification section for the same discipline applied to cost figures): backend jest (NODE_OPTIONS=--experimental-vm-modules jest, testRegex .*\.spec\.ts$, rootDir src) ran 40 suites / 511 tests, and frontend vitest (vitest run) ran 99 files / 592 tests — 139 files and 1103 tests total that day, all passing. Those counts grow with ordinary feature work in either workspace and are not re-verified by this row — they illustrate scale, nothing more. The INVARIANT this row actually enforces outlives every one of them: a single failing assertion anywhere in either workspace turns this exact command, and this row, red, no matter how many tests exist when it runs. | The backend testRegex matches only *.spec.ts, so all 12 *.db-spec.ts suites (backend/jest.db.config.js, a separate config) are excluded from this row entirely — test:db is what covers those. No .tsx file is exercised by the backend suites: the backend has no .tsx files, and only the frontend vitest half of this row ever touches one. And this row cannot see assertion strength: a test that calls a function and asserts nothing about the result is exactly as green as one that checks the answer. |
| `memo` | fast | The generated table region in the root CLAUDE.md, delimited by its verify-table HTML comment markers, is byte-for-byte identical to what scripts/verify/checks/memo-drift.mjs renders from this exact CHECKS array right now, down to the trailing registry-checksum comment — a hand edit on either side, in either direction, fails this exact command. | Nothing about whether a proves or blindSpot string is itself true of its check — only that the table quotes the registry's current values verbatim. And its reach is exactly the marked block: prose elsewhere in CLAUDE.md, including the rest of this Verification section, can drift from reality with this row staying green. |
| `testfiles` | fast | A SNAPSHOT, MEASURED 2026-09-10 and re-measured the same day after Task 10 added a ninth node-test file: 160 files in this repo (jest-unit 40, jest-db 12, vitest 99, node-test 9) currently match *.{test,spec,db-spec}.[cm]?[jt]sx? — up from the 156 (node-test 5) this row first shipped with. That total grows every time this plan, or any ordinary feature work, adds a test file, and this row does not track or re-check its own prose count. The INVARIANT the count only illustrates, and which holds regardless of how large it grows, is this: every one of those files, however many there are, is collected by EXACTLY ONE of this repo's four test runners — jest-unit (backend/package.json's testRegex, rootDir src), jest-db (backend/jest.db.config.js's separate testRegex, also rootDir src), vitest (frontend's default include, no test.include set) and node-test (scripts/**/*.test.mjs, run by npm run test:verify). The two backend regexes are read out of backend/package.json and backend/jest.db.config.js at runtime, not copied here, so this row also proves those two files still say what the check assumes — a file with zero matching collectors, or claimed by two at once, fails this exact command no matter the total. | Nothing about the tests themselves: a file collected by exactly one runner can still assert nothing, or assert the wrong thing — this row only proves each candidate file is picked up once, never that it runs correctly, or at all, once collected. Its candidate pattern is *.{test,spec,db-spec}.* in the [cm]?[jt]sx? extensions; a file that looks like a test under any other name is invisible to it on both sides — reported as neither an orphan nor a false double-collection. And it knows only the four runners this repo has today; a fifth collector added later is unseen by this row until this row is taught about it. |
| `secrets` | fast | This repo's actual credentials — JWT_SECRET and DB_PASSWORD, which live only in the untracked root .env, CI supplying its own throwaway values inline — stay out of git on four fronts. (1) `git ls-files -- .env .env.*`, run at the repo root, returns nothing but .env.example. (2) The three root .gitignore lines that make that true (.env, .env.*, !.env.example) are SHA-256-fingerprinted in scripts/verify/baselines/secret-boundary.json, dated 2026-09-10 — editing, reordering or removing any one of them without a matching baseline update, in the same reviewed commit, fails this exact command. (3) Every tracked file, .md and every other extension alike with no per-file-type exemption (skipping only package-lock.json, integrity hashes by construction, and the baseline file itself), is scanned line by line for a PEM BEGIN…PRIVATE KEY block, a JWT-shaped string (eyJ + two more .-separated base64url segments), and a ≥32-character value assigned to a name matching /secret\|password\|token\|api[_-]?key/i whose WHOLE-VALUE Shannon entropy exceeds 3.5 bits/char and which does not match a placeholder shape named explicitly (changeme, change-me, example, your-, <...>, ...). (4) Every value in .env.example is additionally held to that same placeholder-only standard regardless of what its key is named — on top of, not instead of, check (3). A single tracked file failing any of the four fails this exact command; a real secret is never written into the baseline, which holds only the gitignore fingerprint. | Shannon entropy is measured over the WHOLE value (a run-based measurement was tried and rejected: it scored a real hyphen-separated credential at 2.00 bits/char, comfortably invisible), but it remains a heuristic in both directions — a placeholder shape not yet named in PLACEHOLDER_RE can still false-positive, and any real secret under 32 characters is never inspected at all, full stop. Only a QUOTED string literal is a candidate value anywhere in a line; a bare, unquoted one is a candidate only when it is the entire line, optionally preceded by exactly one of a CLOSED set of four leading tokens (export, ENV, ARG, a YAML `- ` sequence marker) chosen because this repo's own Dockerfiles use ENV/ARG today and docker-compose's `environment:` block has a list form as well as the mapping form already covered. Anything outside that closed list — `const`, `let`, Windows `set`, or no leading token at all when the value is not the whole line — still does not count, on purpose: that is what keeps `const password = process.env.X;` (a property access, not a literal) from tripping this check. This check has exactly one reviewed exception, and it lives in scripts/verify/baselines/secret-boundary.json's confirmedFakeValues array — never in this file's source, and re-validated on every run (a stub reason under 30 characters is rejected; an entry whose pinned value no longer appears in its named file is reported STALE). As a snapshot, 2026-09-10, it holds one already-audited fake token fixture — a count that can only grow by a reviewed, dated addition to that array, never as an unnoticed side effect — in frontend/src/shared/api/persister.test.ts, pinned by its EXACT file path AND its EXACT string — not a shape, not a path, not a file-type carve-out. That exactness cuts both ways: a genuine secret whose literal text happened to equal a pinned value, planted in that same file, would be exactly as invisible to this check as the confirmed fake is. This check also sees only files `git ls-files` tracks RIGHT NOW, at the CURRENT commit — a credential committed and later deleted is invisible to it, history is never searched, and rule 1's pathspec is root-anchored, not recursive, so an errant .env committed inside backend/ or frontend/ would not be named by it either. And it cannot tell a real credential from a convincing fake: this very check's own tests plant a fake PEM header, a JWT built from the literal string "not-a-real-token", and a dash-separated random value, and all three are exactly as red as the genuine article — the shape is all this check ever sees. |
| `seam` | fast | The root CLAUDE.md claim that user_identities(provider, provider_user_id) is the SINGLE login lookup path is mechanically enforced, not just written down, over every backend/src/**/*.ts file parsed with the TypeScript compiler API (not a regex — see the check for why that distinction matters). Two rules: (1) a string literal whose AST text is exactly 'local' is a finding unless the file is under backend/src/migrations/ (a migration is frozen by definition — fix forward, never edit history), under backend/src/seed/ (the standalone dev-seed CLI, never a runtime dependency of the app), is a *.spec.ts/*.db-spec.ts file, or is backend/src/users/user-identity.entity.ts itself — the one file that DECLARES LOCAL_PROVIDER. (2) any import/require/re-export/dynamic-import whose specifier resolves inside backend/src/seed/ is a finding unless the importing file is itself under seed/ or is a spec. A single new occurrence of either shape, anywhere else in backend/src, fails this exact command. | Sees only AST string-literal-like nodes: a provider value assembled at runtime (concatenation, a template literal with a substitution, a value read from an env var, a config file or a database row) is invisible to it in both directions — neither flagged as a second literal nor credited as evidence the seam is used correctly. It does not verify that LOCAL_PROVIDER is actually USED everywhere a login-provider value is needed — only that the bare literal is not duplicated elsewhere; a caller that never imports the constant and never spells out the literal either is unseen by this row. Rule 2's specifier resolution handles only a relative specifier ('./' or '../'), resolved against the importing file's own directory — a bare package specifier is never treated as a path (this repo sets no tsconfig `paths` aliases, so nothing else could resolve into backend/src at all), and a specifier built at runtime rather than written as a plain string literal (a computed require target) is invisible to it, on purpose: nothing here evaluates code. And this check says nothing about whether the seam is the RIGHT design — only that today it still has exactly one declared name for the value it stores, and one reachable path into the seed's own code. |
| `migrations` | fast | `npm run migrations:check` parses every backend/src/**/*.ts file with the TypeScript compiler API and enforces four rules against every file in backend/src/migrations/ — AS A SNAPSHOT, MEASURED 2026-09-10, that was 8 numbered migrations (timestamps 1788600000000–1788600000007) and 5 *.db-spec.ts files; both counts grow with ordinary schema work, unrelated to this table, and this row does not track or re-check its own prose. Excluding the db-specs, the four rules, stated so they hold at any count: (1) every `synchronize` property anywhere under backend/src initialises to the literal `false` (both known sites today, app.module.ts:129 and testing/db-harness.ts:126, and any new one); (2) every non-db-spec file in backend/src/migrations/ matches /^(\d{13})-([A-Za-z0-9]+)\.ts$/ — a stray file of neither shape is itself a finding — and no two migration filenames capture the same 13-digit timestamp, a fixed-width prefix so unique implies strictly ascending; (3) each migration's exported class name equals its filename's name-plus-timestamp (e.g. 1788600000000-InitialSchema.ts exports InitialSchema1788600000000, confirmed against every migration that exists when it runs); and (4), ONLY WHEN origin/main is a resolvable ref, every migration file that already exists there (`git cat-file -e origin/main:<path>`) is byte-identical to that copy (`git diff --quiet origin/main -- <path>`) — a migration new since origin/main needs no comparison and stays green. A violation of 1–3, or of 4 whenever origin/main was reachable, fails this exact command; this row proves rule 4's guarantee ONLY for a run where origin/main was fetched, and says so with a WARNING line — printed even on a passing run — whenever it was not. | Compares TEXT, not schema semantics: two migrations that are each individually well-formed but logically conflict (an `up()` that doesn't undo cleanly in its own `down()`, two migrations that each assume the other's column) are both green — whether a migration is CORRECT, or even runs, is test:db's job, never this row's. Rule 4 cannot see a migration authored and then edited within the SAME pull request as its own creation: it only ever compares against whatever origin/main already has, so anything that happens before that ref updates is invisible to it — and rule 4's whole guarantee is only as strong as origin/main being fetched; when that ref does not resolve, rule 4 is SKIPPED (a WARNING line, never a silent pass) and this row proves nothing about already-merged migrations for that run, though rules 1–3 still apply in full. Filename- and class-name-matching are purely lexical: a correctly named class with a broken body is exactly as green as a correct one. |
| `selfcheck` | fast | AS A SNAPSHOT, MEASURED 2026-09-10 and re-measured the same day after Task 10 added `ratchets/lint-exempt.test.mjs`: `npm run test:verify` (`node --test --test-concurrency=1 'scripts/verify/**/*.test.mjs'`) collects and runs 78 tests across 9 *.test.mjs files — hash.test.mjs (7), registry.test.mjs (8), run.test.mjs (14), checks/memo-drift.test.mjs (4), checks/migration-invariants.test.mjs (8), checks/seam-boundary.test.mjs (13), checks/secret-boundary.test.mjs (13), checks/test-glob-parity.test.mjs (3) and ratchets/lint-exempt.test.mjs (8), 78 in total today — up from the 70-across-8-files this row first shipped with, and due to grow again the next time this plan adds a check. This row does not track or re-check its own prose count; the INVARIANT it actually enforces, independent of how many tests exist when it runs, is this: a single failing assertion anywhere in that suite fails this exact command and turns this row red, which is the whole point of adding it: before this row existed, `npm run verify` ran eight other rows over the rest of the tree — including `typecheck`, which covers scripts/**/*.mjs for TYPES, and `testfiles`, which confirms this layer's own *.test.mjs files are COLLECTED, by node-test specifically — and not one of them RAN this suite, so broken logic inside any check (a ratchet that silently stopped ratcheting, a boundary scan that stopped finding boundaries) could stay green in `npm run verify` indefinitely, caught only by someone remembering to run `npm run test:verify` by hand. | Proves only that each check's tests still agree with that check's code today — self-consistency, not correctness of what the check was designed to catch. A check's tests are written by whoever wrote the check, in the same sitting, so a blind spot baked into the check's own design (a boundary its author never considered, a rule that was always narrower than the prose above it claims) is exactly as invisible to that check's tests as it is to the check itself — this row cannot distinguish a check that is correct from one that is confidently, consistently wrong in a way its own author never tested for. It says nothing about whether any `proves` or `blindSpot` string in this very registry, including this one, is actually TRUE of its check: a `proves` sentence could overstate what its command establishes, or understate a blind spot, and every test in this row could still be green, because this row exercises the CODE the other checks run, never the PROSE describing them — auditing that prose against the registry is `memo`'s job, and `memo` only confirms CLAUDE.md quotes this file verbatim, never that a quoted claim is honest. And a green here says nothing about a check this layer does not yet have — a future crate_issuances or cash_counts boundary check, say — until both that check and its tests exist. |
| `ratchet:lint-exempt` | fast | AS A SNAPSHOT, MEASURED 2026-09-10: `npm run lint:exempt` finds exactly 13 lint exemptions across backend/src, frontend/src and the two flat eslint.config.mjs files today — 10 eslint-disable/-disable-line/-disable-next-line/-enable directive comments (9 disable-type, plus the one eslint-enable that closes test-setup.ts's block disable) and 3 `ignores`-property occurrences bundling 7 individual globs, with zero rules pinned to 'off' in either config. That count moves the instant anyone adds or removes an exemption anywhere in that scan, and this row does not track or re-check its own prose. THIS IS THE FIRST TRUE RATCHET IN THIS LAYER precisely because what it actually enforces does not depend on the count staying 13: every exemption the scan finds, however many there are, matches a dated, ≥30-character-reasoned entry in scripts/verify/baselines/lint-exempt.json, key for key. The comparison runs in both directions, and both are provable by this exact command failing. A NEW exemption anywhere in the scan that is not yet in the baseline fails it (`git ls-files -c -o --exclude-standard` means an untracked, freshly written one counts too). A baseline entry whose exemption NO LONGER EXISTS in the code or config also fails it — a stale forgiveness must be deleted, never left standing, or the baseline only ever grows. And a baseline entry whose `reason` is missing, `TODO`, or under 30 characters after trimming fails the command on the baseline alone, before either direction of that comparison ever runs. | Counts lint suppressions; it does not, and cannot, judge whether any one of them is justified — a reason that reads as 30-plus characters of plausible prose passes exactly as well as one that is actually true, because nothing here re-derives WHY a rule does not apply, only that someone wrote a reason down. A rule that was never enabled in either flat config needs no exemption and stays invisible here — this row proves nothing about the coverage of the rule set itself, only about what is exempted from whatever rules do run today. And because a key embeds the exact line number, an exemption comment or an `ignores` property that merely MOVES to a different line — a reformat, an unrelated edit two lines above it — looks to this check exactly like one exemption removed plus a new one added, even though what it actually suppresses never changed; the same is true, compounded, of a bundled `ignores` entry, where adding or removing even ONE glob from a multi-glob line changes the whole line's key. |

<!-- registry-checksum: 54aa4482b0a3ae15be8bbed99fe44f44 -->
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
