/**
 * The check registry. This file is the point of the whole layer: it is where what a
 * check PROVES and what it stays BLIND TO live side by side, as data, so the runner's
 * output, the CI log and CLAUDE.md cannot drift apart from each other.
 *
 * Rules for editing:
 *  - `proves` must be falsifiable by this exact command failing. If no possible failure
 *    of `cmd` could make the sentence untrue, it is decoration — delete it.
 *  - `blindSpot` must not be written broader than the command establishes.
 *  - `after` only where the dependency is real, not where the order merely feels tidy.
 *  - `supersedes` ONLY where one command demonstrably does another's work — never where two
 *    rows merely overlap, and never to make a slow row go away. It REMOVES a row from the
 *    run, so the row it names must be one whose every possible failure the superseding
 *    command reproduces; and because something is always given up, write down what, on
 *    BOTH rows (see `coverage`/`test`: running without instrumentation).
 *  - `needs` is an ARRAY: a row may depend on more than one precondition at once
 *    (`test:db` needs Postgres AND Redis; `smoke` needs a browser AND Docker), and any
 *    absent one means the whole row is SKIPPED, not FAILED.
 */

import { execFile } from 'node:child_process'
import net from 'node:net'

/**
 * @typedef {'fast' | 'full'} Tier
 * @typedef {'playwright-browser' | 'npm-registry' | 'docker' | 'postgres' | 'redis' | 'jq'} PreconditionId
 */

/**
 * @typedef {object} Check
 * @property {string} id
 * @property {Tier} tier
 * @property {string} cmd              command, run through /bin/sh from the repo root
 * @property {PreconditionId[]} [needs] preconditions; any absent means SKIPPED, not FAILED
 * @property {string[]} [after]        ids that must have PASSED, else NOT_RUN
 * @property {string[]} [supersedes]   ids whose work this row's own command already does;
 *                                     dropped only when BOTH are in the same run — see
 *                                     run.mjs's dropSuperseded for the two safety properties
 * @property {number} [timeoutMs]      this row's own budget; falls back to the runner default
 * @property {string} proves           what a PASSED row establishes
 * @property {string} blindSpot        what it still says nothing about
 */

/**
 * A `timeoutMs` is a HANG DETECTOR, not a performance gate. It is sized well above the
 * row's measured COLD cost on the slowest machine that runs it — a shared CI runner, never
 * a warm laptop — because the only thing it should ever catch is a command that will never
 * finish. The performance signal is the duration the runner prints beside every row; if a
 * row gets slower, that number is what says so, and it says so on a GREEN run.
 *
 * WRITTEN BECAUSE THE DEFAULT SILENTLY DID THE OPPOSITE. The runner's default came from
 * the reference this layer was ported from, whose suites are a fraction of this repo's —
 * 120s, inherited and never checked against a row that relies on it. It is now 60s and
 * measured against all fourteen rows that inherit it (run.mjs's DEFAULT_TIMEOUT_MS lists
 * every reading), which is what exposed `selfcheck` sitting at 67.3s under it. On
 * 2026-09-15 the first CI run of `npm run verify:ci` failed with THREE rows —
 * `test`, `coverage` and `test:db` — each reporting `timed out after 120.0s`, and every
 * one of them would have passed given time. Locally all three were seconds, because Turbo
 * served them from cache and Postgres was already warm: the laptop could not see the
 * failure at all. A per-row budget puts the number next to the row it governs, so the next
 * reader sees WHICH rows are slow and WHY they were given room.
 */

/**
 * @typedef {object} Precondition
 * @property {string} describe   what is missing, in the SKIPPED reason
 * @property {() => Promise<boolean>} probe
 */

/**
 * A precondition answers exactly one question: "are there conditions to run in at all?"
 * It must never answer "did it work". A database that is unreachable is SKIPPED; a
 * database that is reachable and the query wrong is FAILED. Collapsing those two is how
 * a dead suite stays green for months.
 *
 * @param {string} host
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const done = (/** @type {boolean} */ ok) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(2000)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * `docker info` exits 0 only when the CLI can reach a running daemon — a missing
 * binary, a daemon that is not started, and a permission error all resolve `false` here,
 * which is exactly right: every one of them means "nothing to run `smoke` against", not
 * "the check found a problem". It gated the deleted `docker` row too, until 2026-09-15;
 * `smoke` is the only row that needs a daemon now, for the Compose stack it drives.
 *
 * @returns {Promise<boolean>}
 */
function probeDocker() {
  return new Promise((resolve) => {
    execFile('docker', ['info'], { timeout: 4000 }, (err) => resolve(!err))
  })
}

/**
 * `jq --version` exits 0 only when the binary is on PATH — a missing binary is the
 * only failure mode this probes for, exactly like `probeDocker` above. GitHub's
 * `ubuntu-latest` runner image ships jq preinstalled, so this precondition is true
 * in CI unconditionally; it exists for the laptop that has not installed it, where
 * `test:ci-scripts` must be SKIPPED, never FAILED, for a reason that has nothing to
 * do with either script's own correctness.
 *
 * @returns {Promise<boolean>}
 */
function probeJq() {
  return new Promise((resolve) => {
    execFile('jq', ['--version'], { timeout: 4000 }, (err) => resolve(!err))
  })
}

/**
 * A precondition answers exactly one question: "are there conditions to run in at all?"
 * It must never answer "did it work". Postgres unreachable is SKIPPED; Postgres reachable
 * and the migration wrong is FAILED. Collapsing those two is how a dead suite stays green
 * for months.
 *
 * @type {Record<PreconditionId, Precondition>}
 */
export const PRECONDITIONS = {
  'playwright-browser': {
    describe:
      'Chromium for Playwright is not installed (npx playwright install chromium). This ' +
      'checks the exact binary playwright.config.ts launches (channel: chromium), not ' +
      'merely that the @playwright/test package is present. Under --no-skip this is a ' +
      'failure, not "nothing to report".',
    probe: async () => {
      try {
        // @playwright/test, not playwright-core: the transitive package is not ours to
        // depend on directly. It became a real root devDependency with the Playwright
        // e2e suite (Task 17, `smoke`) — before that this import failed both at runtime
        // (caught below, correctly reporting "precondition absent") and statically (no
        // type declarations to resolve), which needed a `@ts-expect-error` suppression
        // here; that suppression is gone now that the import genuinely resolves.
        const { chromium } = await import('@playwright/test')
        const { existsSync } = await import('node:fs')
        return existsSync(chromium.executablePath())
      } catch {
        return false
      }
    },
  },
  'npm-registry': {
    describe:
      'The npm registry is unreachable, so there is nothing to check the advisory ' +
      'database against. This is a missing precondition, not "no vulnerabilities found": ' +
      'under --no-skip this is a failure.',
    probe: async () => {
      try {
        const ac = new AbortController()
        const t = setTimeout(() => ac.abort(), 4000)
        // HEAD on the registry root: cheap, and it answers exactly the question asked.
        const res = await fetch('https://registry.npmjs.org/', {
          method: 'HEAD',
          signal: ac.signal,
        })
        clearTimeout(t)
        return res.ok
      } catch {
        return false
      }
    },
  },
  docker: {
    describe:
      'Docker is not reachable (no CLI, or the CLI cannot reach a running daemon — ' +
      '`docker info` did not exit 0). Under --no-skip this is a failure, not "nothing to ' +
      'report": smoke needs a real daemon to bring up the Compose stack it drives.',
    probe: probeDocker,
  },
  jq: {
    describe:
      'jq is not on PATH (`jq --version` did not exit 0). This is a missing precondition, ' +
      'not "the deploy/cleanup scripts are broken": both scripts/ci/*.sh files this ' +
      'precondition gates parse Coolify/GHCR JSON with jq directly, so there is nothing to ' +
      'run without it. Under --no-skip this is a failure — every GitHub-hosted `ubuntu-' +
      'latest` runner ships jq preinstalled, so CI never SKIPS this row for this reason.',
    probe: probeJq,
  },
  postgres: {
    describe:
      'Postgres is not reachable at DB_HOST/DB_PORT (default localhost:5432). This is a ' +
      'missing precondition, not "the schema is fine": under --no-skip this is a failure, ' +
      'because test:db exercises FOR UPDATE SKIP LOCKED and UNIQUE NULLS NOT DISTINCT ' +
      'behaviour no mocked spec can stand in for.',
    probe: () => canConnect(process.env.DB_HOST ?? 'localhost', Number(process.env.DB_PORT ?? 5432)),
  },
  redis: {
    describe:
      'Redis is not reachable at REDIS_HOST/REDIS_PORT (default localhost:6379). This is a ' +
      'missing precondition, not "throttling works": under --no-skip this is a failure, ' +
      'because the global ThrottlerGuard is backed by Redis and rejects every request ' +
      'without it.',
    probe: () => canConnect(process.env.REDIS_HOST ?? 'localhost', Number(process.env.REDIS_PORT ?? 6379)),
  },
}

/** @type {Check[]} */
export const CHECKS = [
  {
    id: 'lint',
    tier: 'fast',
    cmd: 'npm run lint',
    proves:
      'eslint parsed every file its flat config reaches in both workspaces and reported ' +
      'zero findings at either severity — no parse failure, no error and, because both ' +
      'lint scripts pass --max-warnings=0, no warning either. That includes the money ' +
      'ban, which forbids `*`, `/`, `*=`, `/=`, `Number()`, `toFixed`, `parseInt` and ' +
      "`parseFloat` in the module trees backend/eslint.config.mjs's own `files` list " +
      'names. registry.test.mjs derives that list from the config, so a module owning a ' +
      'money column cannot quietly fall outside it.',
    blindSpot:
      'Nothing about behaviour, and nothing a disabled rule would catch. The money ban ' +
      "reaches only the trees that `files` list names, so arithmetic elsewhere in " +
      'backend/src — config/, users/password-hashing.ts, and both seed modules, which ' +
      "reimplement money.ts's format() and round by truncation — is invisible here, as is " +
      'all of frontend/src including its own shared/lib/money seam. Inside the guarded ' +
      'trees it still misses `Number.parseInt`, `Math.round`, `%` and unary `+`.',
  },
  {
    id: 'typecheck',
    tier: 'fast',
    cmd: 'npm run typecheck',
    proves:
      'Three TypeScript projects compiled with no errors: `turbo typecheck` over both ' +
      'workspaces, `tsconfig.scripts.json` over this layer and .claude/hooks (as JS, with ' +
      'checkJs and strict), and `tsconfig.e2e.json` over playwright.config.ts and e2e/. A ' +
      'type error anywhere in any of the three fails this exact command, including in a ' +
      'check module written this session.',
    blindSpot:
      'Types, not behaviour: a well-typed function that returns the wrong answer is green ' +
      'here. It says nothing about what runs — a module can typecheck and throw at ' +
      'import. It cannot see a `numeric` column mapped to a `number` property, because ' +
      'both are valid TypeScript; that is the `schema` row. Turbo serves cached results, ' +
      'so a green may be a replay rather than a compile.',
  },
  {
    id: 'test',
    tier: 'fast',
    cmd: 'npm test',
    // 1445 tests across two workspaces. Warm on a laptop this is ~27s and CI's first run
    // of it blew through 120s with an empty Turbo cache — see the timeoutMs note above.
    timeoutMs: 600_000,
    proves:
      'Every jest unit suite under backend/src and every vitest suite under frontend/src ' +
      'ran and passed, including `money.ts`\'s example table and its property suite ' +
      'against an independent Decimal oracle — associativity, the half-up tie, ' +
      'round-per-line versus round-the-sum, and agreement with the DTO layer\'s own ' +
      'decimal parser. A single failing assertion in either workspace fails this exact ' +
      'command.',
    blindSpot:
      'No database and no browser. The *.db-spec.ts suites are excluded by jest\'s own ' +
      'testRegex, so every SQL formula — the cash movement sums, the supplier debt ' +
      'aggregation, the void filters — is untested here; that is `test:db`. Mocked ' +
      'repositories cannot evaluate SQL, so a green tells you the TypeScript around the ' +
      'query is right, never the query.',
  },
  {
    id: 'test:ci-scripts',
    tier: 'fast',
    cmd: 'npm run test:ci-scripts',
    needs: ['jq'],
    // No `after`: neither suite reads any other row's output, and both fake their own
    // `curl`/PATH fixtures from scratch on every run.
    proves:
      'Both deploy shell scripts behave under a faked `curl`: ' +
      'scripts/ci/coolify-deploy.sh and ghcr-cleanup.sh are driven through their success, ' +
      'retry, timeout, HTML-instead-of-JSON and log-redaction paths with canned ' +
      'responses, and every assertion passes. These scripts run only in CI, against a ' +
      'live Coolify and GHCR, so this is the only place their logic is exercised at all.',
    blindSpot:
      'A fake curl, not Coolify. It proves the scripts parse and branch correctly on ' +
      'responses this suite invents; it proves nothing about what the real API returns, ' +
      'whether the token is valid, or whether the deployment actually happened. It SKIPS ' +
      'without jq rather than failing. Nothing here runs the workflow YAML that calls ' +
      'these scripts.',
  },
  {
    id: 'testfiles',
    tier: 'fast',
    cmd: 'npm run test:files',
    proves:
      'Every `*.{test,spec,db-spec}` file in the repo, in any js/ts extension, and every ' +
      '`*.test.sh`, is collected by exactly one of six runners. Zero collectors is an ' +
      'ORPHAN, two is DOUBLE-COLLECTED, and either fails this command. The jest regexes ' +
      'and the node-test and shell-test globs are read at runtime from the configs and ' +
      'npm scripts that own them, so this also proves those still say what it assumes.',
    blindSpot:
      'Nothing about the tests themselves: a file collected exactly once can still assert ' +
      'nothing at all. The candidate net is those two filename shapes, so a `*_test.go` ' +
      'or a `test-foo.sh` is invisible on both sides. Three collector ROOTS — ' +
      'backend/src, frontend, e2e — are still written here rather than read from ' +
      '`rootDir` and `testDir`. A seventh runner is unseen until someone teaches it.',
  },
  {
    id: 'secrets',
    tier: 'fast',
    cmd: 'npm run secrets',
    proves:
      'Four boundaries hold: no `.env` or `.env.*` file except `.env.example` is tracked; ' +
      '.gitignore still carries the three lines that keep them out; no tracked file — any ' +
      'extension, .md included — contains a PEM block, a JWT-shaped string or an ' +
      'unexplained high-entropy value on a recognised assignment line; and `.env.example` ' +
      'holds placeholders only. Every accepted exception is dated, reasoned and must ' +
      'still match.',
    blindSpot:
      'Shape, not secrecy. A real credential that looks like a word — a short password, a ' +
      'passphrase, a low-entropy API key — is invisible, and a high-entropy value that is ' +
      'genuinely fake needs a pin to stay green. It reads the working tree, never git ' +
      'history, so a secret committed and then removed is still in the repository and not ' +
      'reported here. Untracked files are outside it entirely.',
  },
  {
    id: 'migrations',
    tier: 'fast',
    cmd: 'npm run migrations:check',
    // No `after`: this check parses backend/src with `ts.createSourceFile` (syntax only),
    // never `ts.createProgram` (type-checking) — a type error does not stop a file from
    // parsing, so an `after: ['typecheck']` here would order two rows that do not
    // actually depend on each other. Verified empirically: with a deliberate type error
    // added to backend/src/app.module.ts (confirmed to fail `tsc`), this check still
    // reported green on the unchanged tree and still correctly caught and located a
    // `synchronize: true` violation planted in that same file alongside the type error —
    // proof the type error neither hides nor fakes a finding here. `seam` (structurally
    // identical: also `ts.createSourceFile` over backend/src) never declared this `after`
    // in the first place, so only this row needed correcting.
    proves:
      '`npm run migrations:check` parses every backend/src `.ts` file with the TypeScript ' +
      'compiler API and fails on: a `synchronize` property not initialised to the literal ' +
      '`false`; a tracked file in backend/src/migrations/ that is neither ' +
      '`<13-digit>-Name.ts` nor `*.db-spec.ts`; two migrations sharing a timestamp; an ' +
      'exported class name that is not filename-name-plus-timestamp; and any already-merged ' +
      'migration that differs from its origin/main copy or has VANISHED since the merge-base.',
    blindSpot:
      'Text, not semantics: a well-formed migration whose SQL is wrong, whose `down()` does ' +
      "not undo its `up()`, or that conflicts with another, is green — correctness is " +
      "`test:db`'s job. Rule 4a compares against origin/main and 4b against the merge-base " +
      'with it, so an edit made inside the pull request that created a migration is ' +
      'invisible, and when either ref is unreachable that rule SKIPS with a WARNING while ' +
      'the rest still apply.',
  },
  {
    id: 'schema',
    tier: 'fast',
    // No `after`, for the reason spelled out on `migrations` above: this check parses
    // backend/src with `ts.createSourceFile` (syntax only), never `ts.createProgram`, so a
    // type error neither hides nor fakes a finding here and ordering it behind `typecheck`
    // would declare a dependency that does not exist.
    //
    // 28-db-schema.dbml is this row's second input, and it is in hash.mjs's HASHED_EXACT —
    // without that, editing the schema of record would leave sourceHash unchanged and
    // `--reuse-if-fresh` would replay a green that never ran this check over it.
    cmd: 'npm run schema:check',
    proves:
      'Every numeric column 28-db-schema.dbml declares matches its TypeORM @Column and its ' +
      'CREATE TABLE SQL on precision, scale, nullability and default, and its TypeScript ' +
      'property type is string, never number. The reverse fails too: a numeric column in an ' +
      'entity or migration the DBML omits. So does anything unmappable — a DBML table with no ' +
      '@Entity, an unparsed Table line, an @Column({ name }), a namingStrategy, or a numeric ' +
      'token outside a CREATE TABLE column.',
    blindSpot:
      'Numeric columns only, and only as written in source. It never opens a database, so a ' +
      'live schema that drifted from its migrations is invisible. It models CREATE TABLE and ' +
      'reports anything else as unmodellable rather than comparing it. Varchar lengths, enums, ' +
      'indexes, CHECK constraints, FK actions and every non-numeric column lie outside it. It ' +
      'proves a property is typed string, not that any caller treats it as one.',
  },
  {
    id: 'documents',
    tier: 'fast',
    // Same reasoning as `schema` and `migrations` for the absent `after`. This row and
    // `schema` share scripts/verify/lib/schema-map.mjs, so they read the same DBML the same
    // way — which is the point: one parser, two questions asked of it.
    cmd: 'npm run documents',
    proves:
      'The scope is derived in three mechanical hops — a voided_at column in 28-db-schema.dbml ' +
      'marks a voidable document, @Entity(table) maps that table to a directory, and every ' +
      '*.controller.ts there is in scope — then parsed with the TypeScript compiler API, ' +
      'failing on any @Patch, @Put or @Delete. §2.7 freezes a recorded document and §9.3 makes ' +
      'a correction a void plus a new one, so an in-place edit verb here is the rule breaking. ' +
      'An empty derivation refuses a verdict.',
    blindSpot:
      'Route decorators only. A service method that overwrites a frozen column, a repository ' +
      'update(), or raw SQL is invisible: this row reads HTTP verbs, not writes. A document ' +
      'table with no voided_at column in the DBML — cash_counts — is outside the derived scope, ' +
      'as is any controller living outside its entity directory. It cannot tell a legitimate ' +
      'void route from an edit disguised as one.',
  },
  {
    id: 'selfcheck',
    // FULL, NOT FAST, and the reason CHANGED — which is worth stating, because a stale
    // justification for a correct decision is how the next person gets talked into
    // reversing it for the wrong reason.
    //
    // It moved out of the fast tier because this suite WROTE THE REAL WORKING TREE: it
    // planted fixtures under backend/src and frontend/src, rewrote several configs, staged
    // paths into the real git index, and deleted tracked source files, all restored in
    // `finally` blocks that a killed process never runs. That is fixed. Every check takes a
    // scan root, every fixture is a mkdtemp directory, and nothing here touches the tree or
    // the index any more — which is also why the suite no longer needs
    // `--test-concurrency=1` and got several times faster when that came off.
    //
    // It stays in the full tier now purely on cost, measured rather than assumed: this row
    // is comparable to the ENTIRE rest of the fast tier put together, so moving it back
    // would roughly double what runs after every turn. The Stop hook pays that on every
    // turn; a gate people route around is worse than no gate.
    //
    // Deliberately NOT split into a cheap fast half and an expensive full half. There is no
    // mechanical rule for which half a new test file belongs in, so the split would be a
    // judgement call on every test added — recurring maintenance, to buy back seconds on
    // rows that mostly re-assert things the fast tier's own rows already fail on directly.
    // `.githooks/pre-push` excludes only smoke/coverage/audit, so a full-tier row JOINS the
    // push gate rather than leaving the layer, and CI's verify:ci runs the full tier.
    tier: 'full',
    cmd: 'npm run test:verify',
    // 240s. The CI readings behind this number (67.3s cold, run 35011857830; 54.4s warm,
    // 35017224544) were taken while the suite still ran its files SERIALLY, so they are
    // upper bounds on what it costs now, not current measurements — left as the basis for
    // the budget precisely because a timeout should be generous against the worst reading,
    // never tuned to the best one.
    //
    // This is still the one row that grows with every test the layer adds, and nothing
    // caches `node --test`. The margin buys room for that growth rather than for a hang. A
    // hang here would be a test that never returns, and that is what this catches.
    timeoutMs: 240_000,
    // No `after`: nothing this suite does depends on another row having passed first.
    // It runs the layer's own .mjs sources directly under node:test — untranspiled,
    // untyped at runtime — so a failure or a pass in `typecheck` changes nothing about
    // whether these tests execute or what they observe; and it does not read `lint`,
    // `testfiles`, `secrets` or `migrations` output, only the source files those
    // commands also happen to run. `run.mjs` runs every row strictly sequentially (a
    // `for` loop that `await`s each `runCommand` before starting the next — see
    // run.mjs's main()), and no test here writes a tree any other row reads, so there is
    // nothing for an ordering constraint to protect.
    proves:
      'Every test the verify layer has for itself ran and passed: the runner\'s status and ' +
      'freshness logic, the hash surface in both directions, the Stop gate\'s four failure ' +
      'branches, the report contract against a report the runner really wrote, and each ' +
      'check driven against throwaway fixture repositories. A ratchet that silently ' +
      'stopped ratcheting fails here.',
    blindSpot:
      'The layer, not the application. Everything it asserts is about checks, so a green ' +
      'says nothing about backend/src or frontend/src. It runs at pre-push and in CI ' +
      'rather than per turn, so a check broken mid-session is caught when you push. A ' +
      'check with no test for a behaviour is green about that behaviour here, exactly as ' +
      'it is everywhere else.',
  },
  {
    id: 'deadcode',
    // FULL, NOT FAST, and the reason is the ordinary way people write frontend code: you
    // create a component, and you wire it up in the next edit. Between those two moments
    // the file is imported by nothing, which is exactly what knip reports — correctly. The
    // Stop hook runs the fast tier after EVERY turn, so a fast-tier `deadcode` turns that
    // completely normal intermediate state into a red gate, and the only ways out are to
    // baseline a file you are about to wire up anyway or to stop reading the gate. Both are
    // worse than waiting.
    //
    // Nothing is given up by waiting: `.githooks/pre-push` excludes only smoke/coverage/
    // audit, so this still blocks every push, and CI's verify:ci runs the full tier. Dead
    // code is not a correctness defect that gets harder to find later — it is still there
    // at push time, which is the first moment the answer is even meaningful.
    tier: 'full',
    cmd: 'npm run deadcode',
    // No `after`: unlike ratchet:persist/seam/migrations (a syntax-only
    // ts.createSourceFile parse, unaffected by type errors by construction), knip DOES run
    // real type-aware analysis internally — so this needed checking empirically, not just
    // reasoning from the tool's own architecture. Verified 2026-09-10 the same way
    // `migrations` documents: with a deliberate type error planted in backend/src/app.module.ts
    // (confirmed to fail `tsc -p backend/tsconfig.json --noEmit` with one TS2322), `knip
    // --reporter json`'s full output was BYTE-FOR-BYTE IDENTICAL to the clean-tree run —
    // same 120 findings, same everything. A type error neither hides nor fakes a finding
    // here, so an `after: ['typecheck']` would order two rows that do not actually depend
    // on each other.
    proves:
      '`npx knip` over both workspaces and the repo root, with every finding matched ' +
      'against the recorded baseline in BOTH directions — a new finding fails, and so ' +
      'does a line knip no longer reports. Three things knip cannot enforce on itself are ' +
      'checked beside it: knip.json may carry only entry and project keys, its globs are ' +
      'fingerprinted into the baseline, and a `@public`/`@beta`/`@alias` tag on any ' +
      'export is red.',
    blindSpot:
      'knip infers reachability from static imports, so framework-invoked code — TypeORM ' +
      'migrations, db-spec suites, the .claude hooks — looks alive only because knip.json ' +
      'names it as an entry point, and a dynamically required module still reads as ' +
      'unlisted. A baselined line means the finding is KNOWN, never that the code is ' +
      'acceptable. Nothing here judges the code knip does not flag.',
  },
  {
    id: 'audit',
    tier: 'full',
    cmd: 'npm run audit:check',
    // 120s, and this row declares one for a reason none of the others share: ITS DURATION
    // IS NOT A PROPERTY OF THIS REPOSITORY. `needs: ['npm-registry']` is the whole point —
    // the command talks to a server nobody here operates, so the 2.3s it measured cold on
    // CI (run 35011857830) bounds a good day and says nothing whatever about a slow one.
    // Every other row's cost is our own code and scales with our own tree.
    //
    // Under a shared default tight enough to be useful for rows like `lint`, a slow
    // registry becomes a RED row on a green tree — a hang detector reporting someone
    // else's outage as our defect, which is precisely the false signal this field exists
    // to avoid. 120s is deliberately loose against the measurement for that reason, not
    // because the row is slow. Raised as a point by a review of the default's own
    // reasoning, 2026-09-16, rather than by a failure.
    timeoutMs: 120_000,
    needs: ['npm-registry'],
    // No `after`: audit.mjs never invokes eslint or tsc, only `npm ls`/`npm audit` — a red
    // `lint` or `typecheck` row changes nothing about what npm's own advisory database
    // says. Its ONLY real dependency is the registry being reachable at all, which is
    // exactly what `needs: ['npm-registry']` (not `after`) exists to express: a missing
    // precondition SKIPS this row, it does not order it behind another check.
    proves:
      'Every GHSA advisory npm reports is accepted by id in audit.mjs, with an expiry date ' +
      'and a reason, in BOTH directions: an unaccepted advisory fails, an accepted one npm ' +
      'has stopped reporting fails, and so does one whose date has passed. A critical ' +
      'reachable from the production tree can never be accepted. Reachability is read from ' +
      'npm, not declared.',
    blindSpot:
      'Only what npm knows today. An unpublished vulnerability, one in code this repo ' +
      'vendors rather than installs, and one in a base image are all invisible. Its ' +
      'verdict depends on a database that changes with nothing in this repo, which is why ' +
      'it SKIPS without the registry and sits outside the push gate. An accepted advisory ' +
      'is one somebody read, not one that is harmless.',
  },
  {
    id: 'build',
    tier: 'full',
    cmd: 'npm run build',
    // No `after`: both workspaces' own build commands run their own compiler internally
    // (backend's `nest build` and frontend's `tsc -b` half of `tsc -b && vite build`), so a
    // type error is already caught by THIS command without needing `typecheck` to have run
    // first — ordering this after `typecheck` would pair two rows that each independently
    // catch the same class of failure, not express a real dependency.
    proves:
      'Both workspaces built for production: nest\'s tsc emit for the backend and Vite\'s ' +
      'rollup bundle for the frontend, each exiting zero. This is the only row that ' +
      'exercises the production path — module resolution, tree-shaking, asset handling ' +
      'and every plugin in the chain — rather than the dev or test one.',
    blindSpot:
      'It builds, it does not run. A bundle that boots to a blank page, a missing runtime ' +
      'env var, a broken lazy import behind a route nobody visits — all green here. Size ' +
      'is `bundle`\'s question, behaviour in a browser is `smoke`\'s. Turbo caches this ' +
      'task, so a green can be a replay of an earlier tree.',
  },
  {
    id: 'coverage',
    tier: 'full',
    cmd: 'npm run coverage',
    // THE SAME SUITES — SO `test` DOES NOT RUN BESIDE IT. The note below already said this
    // row re-runs the whole suite itself; until 2026-09-15 `test` then ran it a SECOND time
    // in every full-tier run, and CI measured the pair at 220.4s + 254.6s on run
    // 34998136933 — eight of that run's twenty minutes spent proving the same thing twice.
    // The removal is conditional on this row actually being in the run (run.mjs's
    // dropSuperseded), which is why `--exclude coverage` and the fast tier still run `test`
    // normally. What it costs is written into both rows' prose rather than left implied.
    supersedes: ['test'],
    // The same two suites again, under instrumentation, and never served from Turbo's
    // cache on a first run. Budgeted like `test`, for the same reason.
    timeoutMs: 600_000,
    // No `after`: this row re-runs the full suite itself (jest --coverage / vitest run
    // --coverage), so a failing test fails THIS command directly — it does not need `test`
    // to have already passed, and ordering it behind `test` would only make a red `test`
    // block a row that would report the identical failure on its own.
    proves:
      'The same jest and vitest suites `test` runs, re-run under instrumentation, with ' +
      'every configured threshold met. Locally those thresholds come from unset ' +
      'COVERAGE_* variables and default to zero, so a local green is a MEASUREMENT; in CI ' +
      'the workflow sets real floors per workspace and a drop below any of them fails ' +
      'this exact command.',
    blindSpot:
      'Lines executed, not behaviour asserted. A suite that calls every branch and ' +
      'expects nothing scores identically to one that checks each result. It cannot ' +
      'distinguish a line covered incidentally from a line covered on purpose. And it ' +
      'says nothing about code no suite imports at all — that is `deadcode`\'s question, ' +
      'not this one.',
  },
  {
    id: 'bundle',
    tier: 'full',
    cmd: 'npm run bundle',
    after: ['build'],
    // THIS IS THE FIRST REAL `after` IN THIS REGISTRY — every earlier row's own `after`
    // comment argues why ordering was NOT needed; this one argues the opposite. bundle-
    // size.mjs reads frontend/dist/index.html and frontend/dist/assets directly off disk;
    // unlike `coverage` (re-runs the whole suite itself) or `audit` (shells out to npm's own
    // tooling), it builds nothing. Reading index.html makes a stale tree MORE dangerous, not
    // less: an index.html left by an earlier commit names chunk hashes a fresh assets
    // directory does not contain, which the check now refuses outright rather than measuring
    // the smaller first load it could still see.
    // Without `build` having actually PASSED first, this row runs against whatever happens
    // to already be sitting in frontend/dist: nothing at all on a fresh checkout (a clear,
    // named failure — see measure()'s own message), or worse, a STALE tree left over from an
    // earlier commit or an unrelated manual `npm run build` — silently measuring the wrong
    // bytes and reporting a false verdict either way. `run.mjs`'s `after` mechanism (generic,
    // and unrelated to anything in this check's own code) is what turns a `build` that did
    // not PASS into `bundle` reporting NOT_RUN instead of measuring that stale-or-missing
    // directory — verified empirically for this task's report: with `build` forced to fail,
    // `bundle` reported NOT_RUN, naming `build` as the unmet dependency, never FAILED and
    // never a false PASSED against the tree `build` left behind.
    proves:
      'The first-load set named by frontend/dist/index.html — the entry script, its ' +
      'stylesheets and every modulepreloaded chunk — is inside the recorded ceiling, gzip ' +
      'and raw. The ceiling is derived, not chosen: measurement plus a minimum headroom, ' +
      'rounded to a step, written only by an explicit --write. WARNING lines print the ' +
      'headroom left, the total shipped and how much of it is deferred, and the largest ' +
      'JS chunk, on every PASSING run — those numbers, not the verdict, are the point.',
    blindSpot:
      'Bytes, never load time, and caching is invisible: a returning visitor pays less ' +
      'than anything printed here. The deferred chunks carry no ceiling at all, so a lazy ' +
      'route may grow without limit and this row stays green. No per-chunk ceiling ' +
      'either, so one eager file may fill the whole budget. It measures the last ' +
      '`build`\'s output, so a stale dist gives a stale verdict.',
  },
  {
    id: 'test:db',
    tier: 'full',
    cmd: 'npm run test:db -w backend',
    // THE 480s AND 1200s BUDGETS THIS ROW CARRIED WERE CHASING A BUG, NOT A COST, and the
    // record is kept here rather than quietly deleted. This row was killed at 480s on
    // 2026-09-15 (run 34998136933), the only red row in an otherwise green 21; the budget
    // was raised to 1200s purely to buy one complete reading, since nobody knew what the
    // row cost. That framing was wrong. Measured on 2026-09-15 (run 35008065574, three
    // jobs, and the probes in run 35010492674):
    //
    //   the same command, Actions `services:` Postgres, nothing else run first     31s
    //   the same command, Compose Postgres, nothing else run first        >21 min, killed
    //   Compose Postgres itself: 0.26ms per round trip, DROP 10ms, CREATE 23ms
    //
    // A healthy database, and a 40x gap. The cause was `app_test` simply not existing: the
    // `services:` block set `POSTGRES_DB: app_test` and docker-compose.yml sets
    // `POSTGRES_DB: app`, and the three suites that boot the whole AppModule never created
    // it (every other suite does, through `openTestDataSource()`). The app then retried the
    // missing database every 3s, all 70 of their tests died at jest's 30s testTimeout,
    // their `afterAll` never ran, and jest — holding the handles teardown would have closed
    // — never exited. The suites had actually finished after about 100 seconds.
    //
    // Fixed at the source: `ensureTestDatabase()` in backend/src/testing/db-harness.ts,
    // called by all three, with backend/src/testing/db-harness.db-spec.ts reproducing the
    // failure by dropping the database first. With it, the full suite runs GREEN against a
    // deliberately dropped app_test in 21s on a laptop — the same 20s this row always cost.
    //
    // THE CI READING NOW EXISTS, and this budget is sized from it rather than from a guess:
    // run 35011857830, the first ever to carry this row to completion, measured 28.9s —
    // against 25s as its own job on main and 21s on a laptop with app_test deliberately
    // dropped. Three machines, one number. 300s is roughly ten times that, which is what a
    // HANG DETECTOR should be: nothing about a healthy run comes near it, and the next hang
    // is reported as a clean FAILED row in five minutes instead of twenty.
    timeoutMs: 300_000,
    needs: ['postgres', 'redis'],
    proves:
      'Every *.db-spec.ts suite ran against a real Postgres, each against a freshly ' +
      'dropped and re-migrated database. This is where the SQL lives: the cash movement ' +
      'sums, the supplier debt aggregation, the §9.4 void-authorization matrix over real ' +
      'guards, cross-point scoping, row locking and the migration DDL itself. No mocked ' +
      'repository can evaluate any of it.',
    blindSpot:
      'One schema shape, built by replaying migrations into an empty database. It says ' +
      'nothing about production DATA — a row that violates an invariant added later is ' +
      'invisible — and nothing about a migration\'s behaviour against an existing table ' +
      'with rows in it. It SKIPS without Postgres and Redis rather than failing, and a ' +
      'SKIPPED row is a row nobody ran.',
  },
  {
    id: 'smoke',
    tier: 'full',
    cmd: 'npm run test:e2e',
    // 180s. Measured 36.6s cold and 49.7s warm on CI (runs 35011857830 and 35017224544) —
    // warm is the SLOWER of the two here, which is itself worth knowing: this row's cost is
    // a frontend build plus a Compose stack coming up, neither of which Turbo caches, so
    // the variance is the runner's rather than the cache's. It relied on the runner default
    // until 2026-09-16 and no longer fits under the 60s that default now is.
    //
    // 180s is ~3.6x the worst reading. The hang it exists to catch is real and named in
    // this row's own proves: an earlier version of it died on `Timed out waiting 60000ms
    // from config.webServer` with global-setup.ts never having run a line.
    timeoutMs: 180_000,
    needs: ['playwright-browser', 'docker'],
    after: ['build'],
    // Not a hard dependency the way `bundle`'s `after: ['build']` is: playwright.config.ts's
    // `webServer` builds the frontend itself, every run, before serving it — see its own doc
    // comment (FIX ROUND 2) for why relying on a PRIOR `npm run build` cannot be trusted:
    // Playwright starts `webServer` BEFORE `global-setup.ts` ever runs, so this row does not
    // depend on `build` having passed to produce a CORRECT result. `after` still buys what it
    // buys for `bundle`: skipping the single heaviest, slowest row in this whole layer — a real
    // browser against a real Docker Compose stack — when the cheap compiler check already
    // failed is strictly better than re-discovering the identical compile error more slowly.
    proves:
      'The Compose stack came up and a real Chromium drove the built frontend against the ' +
      'real backend and Postgres: a seeded operator signs in, the app renders, and the ' +
      'critical path answers. This is the only row where nginx, the JWT round trip, the ' +
      'built bundle and the database are all exercised together, as a user meets them.',
    blindSpot:
      'One browser, one path, seeded data. Nothing about other engines, other viewports, ' +
      'accessibility, or any flow the spec does not walk. It SKIPS without Docker or a ' +
      'Playwright browser. Because it seeds and drives a live stack, a pass says the ' +
      'happy path works today — never that an edge case, a concurrent user or a slow ' +
      'network behaves.',
  },
]

/** @type {Record<Tier, number>} */
const TIER_RANK = { fast: 0, full: 1 }

/**
 * `fast` is a subset of `full`, so a full run includes every fast check.
 *
 * @param {Tier} checkTier
 * @param {Tier} runTier
 * @returns {boolean}
 */
export function inTier(checkTier, runTier) {
  return TIER_RANK[checkTier] <= TIER_RANK[runTier]
}

/**
 * A green recorded at `fast` says nothing about `full`.
 *
 * @param {Tier} stored
 * @param {Tier} wanted
 * @returns {boolean} true when `stored` covers at least as much as `wanted`
 */
export function tierCovers(stored, wanted) {
  return TIER_RANK[stored] >= TIER_RANK[wanted]
}

/** @param {string} id @returns {Check | undefined} */
export function checkById(id) {
  return CHECKS.find((c) => c.id === id)
}
