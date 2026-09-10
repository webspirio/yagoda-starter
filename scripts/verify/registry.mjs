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
 *  - `needs` is an ARRAY: a row may depend on more than one precondition at once
 *    (`test:db` needs Postgres AND Redis; `smoke` needs a browser AND Docker), and any
 *    absent one means the whole row is SKIPPED, not FAILED.
 */

import { execFile } from 'node:child_process'
import net from 'node:net'

/**
 * @typedef {'fast' | 'full'} Tier
 * @typedef {'playwright-browser' | 'npm-registry' | 'docker' | 'postgres' | 'redis'} PreconditionId
 */

/**
 * @typedef {object} Check
 * @property {string} id
 * @property {Tier} tier
 * @property {string} cmd              command, run through /bin/sh from the repo root
 * @property {PreconditionId[]} [needs] preconditions; any absent means SKIPPED, not FAILED
 * @property {string[]} [after]        ids that must have PASSED, else NOT_RUN
 * @property {string} proves           what a PASSED row establishes
 * @property {string} blindSpot        what it still says nothing about
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
 * which is exactly right: every one of them means "nothing to run `docker:build` or
 * `smoke` against", not "the check found a problem".
 *
 * @returns {Promise<boolean>}
 */
function probeDocker() {
  return new Promise((resolve) => {
    execFile('docker', ['info'], { timeout: 4000 }, (err) => resolve(!err))
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
        // depend on directly. It is not yet a dependency of this repo at all — that
        // lands with the Playwright e2e suite — so this import fails both at runtime
        // (caught below, correctly reporting "precondition absent") and statically
        // (no type declarations to resolve), hence the suppression on the next line.
        // @ts-expect-error — @playwright/test ships with the e2e suite, not yet
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
      'report": docker:build and smoke need a real daemon to build and serve the image.',
    probe: probeDocker,
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
      'eslint parsed every file its flat config reaches in both workspaces ' +
      '(backend/eslint.config.mjs, frontend/eslint.config.mjs) and reported zero findings ' +
      'at either severity — no parse failure, no rule violation at error severity, and, ' +
      'because both lint scripts now pass --max-warnings=0, no warning either: ' +
      'react-hooks/exhaustive-deps and react-refresh/only-export-components, both ' +
      'configured at warn, are exactly as blocking here as an error-level rule. That ' +
      'includes the money-arithmetic ban scoped to backend/src/intakes, src/payouts, ' +
      'src/shifts and src/supplier-balance, which forbids *, /, Number(), toFixed, ' +
      'parseInt and parseFloat there (test files in those four trees are excluded by the ' +
      'same config).',
    blindSpot:
      'Nothing about behaviour: whether a sum is right, whether a component renders. A ' +
      'rule that is not enabled does not exist for it, and the money ban covers exactly ' +
      'FOUR backend module trees — arithmetic on a numeric string anywhere else (every ' +
      'other backend module, and the whole of frontend/src) is invisible to this row.',
  },
  {
    id: 'typecheck',
    tier: 'fast',
    cmd: 'npm run typecheck',
    proves:
      'tsc reports zero type errors across every project the typecheck command spans: ' +
      'backend (tsc -p tsconfig.json --noEmit, strict mode, over everything under ' +
      'backend/src including *.spec.ts and *.db-spec.ts — there are no backend .ts files ' +
      'outside src/), frontend (tsc -b, building tsconfig.app.json over src/ and ' +
      'tsconfig.node.json over vite.config.ts), and the verify layer itself (tsc -p ' +
      'tsconfig.scripts.json, checkJs, over scripts/**/*.mjs and .claude/hooks/**/*.mjs). ' +
      'A type error in any one of those three projects fails this exact command.',
    blindSpot:
      'Nothing about runtime data: a field typed as a plain string accepts any string tsc ' +
      'never inspects the value of, and every `as` cast and non-null assertion (`!`) is a ' +
      'hole this row does not look through. JSON parsed from a database row, an HTTP body ' +
      'or a JWT payload is trusted at the type boundary, not verified. And its reach is ' +
      'exactly the three tsconfig files above: a file none of their include/exclude rules ' +
      'reaches is not type-checked by this row at all.',
  },
  {
    id: 'test',
    tier: 'fast',
    cmd: 'npm test',
    proves:
      'A SNAPSHOT, MEASURED 2026-09-10 (see CLAUDE.md\'s Verification section for the same ' +
      'discipline applied to cost figures): backend jest (NODE_OPTIONS=--experimental-vm-' +
      'modules jest, testRegex .*\\.spec\\.ts$, rootDir src) ran 40 suites / 511 tests, and ' +
      'frontend vitest (vitest run) ran 99 files / 592 tests — 139 files and 1103 tests ' +
      'total that day, all passing. Those counts grow with ordinary feature work in either ' +
      'workspace and are not re-verified by this row — they illustrate scale, nothing more. ' +
      'The INVARIANT this row actually enforces outlives every one of them: a single ' +
      'failing assertion anywhere in either workspace turns this exact command, and this ' +
      'row, red, no matter how many tests exist when it runs.',
    blindSpot:
      "The backend testRegex matches only *.spec.ts, so all 12 *.db-spec.ts suites " +
      '(backend/jest.db.config.js, a separate config) are excluded from this row entirely ' +
      '— test:db is what covers those. No .tsx file is exercised by the backend suites: ' +
      'the backend has no .tsx files, and only the frontend vitest half of this row ever ' +
      'touches one. And this row cannot see assertion strength: a test that calls a ' +
      'function and asserts nothing about the result is exactly as green as one that ' +
      'checks the answer.',
  },
  {
    id: 'memo',
    tier: 'fast',
    // The direct command, not `npm run memo`: this is the one row whose entire job is
    // catching drift, so it must keep working even if the npm script entry is ever lost.
    cmd: 'node scripts/verify/checks/memo-drift.mjs',
    proves:
      'The generated table region in the root CLAUDE.md, delimited by its verify-table ' +
      'HTML comment markers, is byte-for-byte identical to what scripts/verify/checks/' +
      'memo-drift.mjs renders from this exact CHECKS array right now, down to the ' +
      'trailing registry-checksum comment — a hand edit on either side, in either ' +
      'direction, fails this exact command.',
    blindSpot:
      'Nothing about whether a proves or blindSpot string is itself true of its check — ' +
      "only that the table quotes the registry's current values verbatim. And its reach is " +
      'exactly the marked block: prose elsewhere in CLAUDE.md, including the rest of this ' +
      'Verification section, can drift from reality with this row staying green.',
  },
  {
    id: 'testfiles',
    tier: 'fast',
    cmd: 'npm run test:files',
    proves:
      "Every one of this repo's *.{test,spec,db-spec}.[cm]?[jt]sx? files is collected by " +
      "EXACTLY ONE of this repo's four test runners — jest-unit " +
      "(backend/package.json's testRegex, rootDir src), jest-db (backend/jest.db.config.js's " +
      "separate testRegex, also rootDir src), vitest (frontend's default include, no " +
      'test.include set) and node-test (scripts/**/*.test.mjs, run by npm run test:verify) ' +
      '— a file with zero matching collectors, or claimed by two at once, fails this exact ' +
      'command, no matter how many files exist when it runs. The two backend regexes are ' +
      'read out of backend/package.json and backend/jest.db.config.js at runtime, not ' +
      'copied here, so this row also proves those two files still say what the check ' +
      'assumes. AS A SNAPSHOT, MEASURED 2026-09-10 and re-measured the same day after Task ' +
      '10 added a ninth node-test file: 160 files currently match that pattern (jest-unit ' +
      '40, jest-db 12, vitest 99, node-test 9) — up from the 156 (node-test 5) this row ' +
      'first shipped with. That total grows every time this plan, or any ordinary feature ' +
      'work, adds a test file, and this row does not track or re-check its own prose count.',
    blindSpot:
      'Nothing about the tests themselves: a file collected by exactly one runner can ' +
      'still assert nothing, or assert the wrong thing — this row only proves each ' +
      'candidate file is picked up once, never that it runs correctly, or at all, once ' +
      'collected. Its candidate pattern is *.{test,spec,db-spec}.* in the [cm]?[jt]sx? ' +
      'extensions; a file that looks like a test under any other name is invisible to it ' +
      'on both sides — reported as neither an orphan nor a false double-collection. And ' +
      'it knows only the four runners this repo has today; a fifth collector added later ' +
      'is unseen by this row until this row is taught about it.',
  },
  {
    id: 'secrets',
    tier: 'fast',
    cmd: 'npm run secrets',
    proves:
      "This repo's actual credentials — JWT_SECRET and DB_PASSWORD, which live only in the " +
      'untracked root .env, CI supplying its own throwaway values inline — stay out of git ' +
      'on four fronts. (1) `git ls-files -- .env .env.*`, run at the repo root, returns ' +
      'nothing but .env.example. (2) The three root .gitignore lines that make that true ' +
      '(.env, .env.*, !.env.example) are SHA-256-fingerprinted in ' +
      'scripts/verify/baselines/secret-boundary.json, dated 2026-09-10 — editing, ' +
      'reordering or removing any one of them without a matching baseline update, in the ' +
      'same reviewed commit, fails this exact command. (3) Every tracked file, .md and ' +
      'every other extension alike with no per-file-type exemption (skipping only ' +
      'package-lock.json, integrity hashes by construction, and the baseline file itself), ' +
      'is scanned line by line for a PEM BEGIN…PRIVATE KEY block, a JWT-shaped ' +
      'string (eyJ + two more .-separated base64url segments), and a ≥32-character value ' +
      'assigned to a name matching /secret|password|token|api[_-]?key/i whose WHOLE-VALUE ' +
      'Shannon entropy exceeds 3.5 bits/char and which does not match a placeholder shape ' +
      'named explicitly (changeme, change-me, example, your-, <...>, ...). (4) Every value ' +
      'in .env.example is additionally held to that same placeholder-only standard ' +
      'regardless of what its key is named — on top of, not instead of, check (3). A single ' +
      'tracked file failing any of the four fails this exact command; a real secret is ' +
      'never written into the baseline, which holds only the gitignore fingerprint.',
    blindSpot:
      'This check is a heuristic in both directions, not a proof: a placeholder shape not ' +
      'yet named in PLACEHOLDER_RE can still false-positive, and any real secret under 32 ' +
      'characters is never inspected at all, full stop. Shannon entropy is measured over ' +
      'the WHOLE value — a run-based measurement was tried and rejected, since it scored a ' +
      'real hyphen-separated credential at 2.00 bits/char, comfortably invisible. Only a ' +
      'QUOTED string ' +
      'literal is a candidate value anywhere in a line; a bare, unquoted one is a candidate ' +
      'only when it is the entire line, optionally preceded by exactly one of a CLOSED set ' +
      'of four leading tokens (export, ENV, ARG, a YAML `- ` sequence marker) chosen ' +
      "because this repo's own Dockerfiles use ENV/ARG today and docker-compose's " +
      '`environment:` block has a list form as well as the mapping form already covered. ' +
      'Anything outside that closed list — `const`, `let`, Windows `set`, or no leading ' +
      'token at all when the value is not the whole line — still does not count, on ' +
      'purpose: that is what keeps `const password = process.env.X;` (a property access, ' +
      'not a literal) from tripping this check. This check has exactly one reviewed ' +
      'exception, and it lives in ' +
      'scripts/verify/baselines/secret-boundary.json\'s confirmedFakeValues array — never ' +
      'in this file\'s source, and re-validated on every run (a stub reason under 30 ' +
      'characters is rejected; an entry whose pinned value no longer appears in its named ' +
      'file is reported STALE). As a snapshot, 2026-09-10, it holds one already-audited ' +
      'fake token fixture — a count that can only grow by a reviewed, dated addition to ' +
      "that array, never as an unnoticed side effect — in " +
      'frontend/src/shared/api/persister.test.ts, pinned by its EXACT file path AND its ' +
      'EXACT string — not a shape, not a path, not a file-type carve-out. That exactness ' +
      'cuts both ways: a genuine secret whose literal text happened to equal a pinned ' +
      'value, planted in that same file, would be exactly as invisible to this check as the ' +
      'confirmed fake is. This check also sees only files `git ls-files` tracks RIGHT NOW, ' +
      "at the CURRENT commit — a credential committed and later deleted is invisible to " +
      "it, history is never searched, and rule 1's pathspec is root-anchored, not " +
      'recursive, so an errant .env committed inside backend/ or frontend/ would not be ' +
      'named by it either. And it cannot tell a real credential from a convincing fake: ' +
      "this very check's own tests plant a fake PEM header, a JWT built from the literal " +
      'string "not-a-real-token", and a dash-separated random value, and all three are ' +
      'exactly as red as the genuine article — the shape is all this check ever sees.',
  },
  {
    id: 'seam',
    tier: 'fast',
    cmd: 'npm run seam',
    proves:
      "The root CLAUDE.md claim that user_identities(provider, provider_user_id) is the " +
      'SINGLE login lookup path is mechanically enforced, not just written down, over ' +
      'every backend/src/**/*.ts file parsed with the TypeScript compiler API (not a ' +
      'regex — see the check for why that distinction matters). Two rules: (1) a string ' +
      "literal whose AST text is exactly 'local' is a finding unless the file is under " +
      'backend/src/migrations/ (a migration is frozen by definition — fix forward, never ' +
      'edit history), under backend/src/seed/ (the standalone dev-seed CLI, never a ' +
      'runtime dependency of the app), is a *.spec.ts/*.db-spec.ts file, or is ' +
      'backend/src/users/user-identity.entity.ts itself — the one file that DECLARES ' +
      'LOCAL_PROVIDER. (2) any import/require/re-export/dynamic-import whose specifier ' +
      'resolves inside backend/src/seed/ is a finding unless the importing file is itself ' +
      'under seed/ or is a spec. A single new occurrence of either shape, anywhere else in ' +
      'backend/src, fails this exact command.',
    blindSpot:
      'Sees only AST string-literal-like nodes: a provider value assembled at runtime ' +
      '(concatenation, a template literal with a substitution, a value read from an env ' +
      'var, a config file or a database row) is invisible to it in both directions — ' +
      'neither flagged as a second literal nor credited as evidence the seam is used ' +
      'correctly. It does not verify that LOCAL_PROVIDER is actually USED everywhere a ' +
      'login-provider value is needed — only that the bare literal is not duplicated ' +
      'elsewhere; a caller that never imports the constant and never spells out the ' +
      "literal either is unseen by this row. Rule 2's specifier resolution handles only a " +
      "relative specifier ('./' or '../'), resolved against the importing file's own " +
      'directory — a bare package specifier is never treated as a path (this repo sets no ' +
      'tsconfig `paths` aliases, so nothing else could resolve into backend/src at all), ' +
      'and a specifier built at runtime rather than written as a plain string literal ' +
      '(a computed require target) is invisible to it, on purpose: nothing here evaluates ' +
      'code. And this check says nothing about whether the seam is the RIGHT design — only ' +
      'that today it still has exactly one declared name for the value it stores, and one ' +
      "reachable path into the seed's own code.",
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
      '`npm run migrations:check` parses every backend/src/**/*.ts file with the ' +
      'TypeScript compiler API and enforces four rules, stated here so each holds at any ' +
      'count: (1) every ' +
      '`synchronize` property anywhere under backend/src initialises to the literal ' +
      '`false` (both known sites today, app.module.ts:129 and testing/db-harness.ts:126, ' +
      'and any new one); (2) every non-db-spec file in backend/src/migrations/ matches ' +
      '/^(\\d{13})-([A-Za-z0-9]+)\\.ts$/ — a stray file of neither shape ' +
      'is itself a finding — and no two migration filenames capture the same 13-digit ' +
      'timestamp, a fixed-width prefix so unique implies strictly ascending; (3) each migration\'s ' +
      "exported class name equals its filename's name-plus-timestamp (e.g. " +
      '1788600000000-InitialSchema.ts exports InitialSchema1788600000000, confirmed ' +
      'against every migration that exists when it runs); and (4), ONLY WHEN origin/main is a resolvable ' +
      'ref, every migration file that already exists there (`git cat-file -e ' +
      'origin/main:<path>`) is byte-identical to that copy (`git diff --quiet origin/main ' +
      '-- <path>`) — a migration new since origin/main needs no comparison and stays ' +
      'green. A violation of 1–3, or of 4 whenever origin/main was reachable, fails this ' +
      "exact command; this row proves rule 4's guarantee ONLY for a run where origin/main " +
      'was fetched, and says so with a WARNING line — printed even on a passing run — ' +
      'whenever it was not. AS A SNAPSHOT, MEASURED 2026-09-10: backend/src/migrations/ ' +
      'held 8 numbered migrations (timestamps 1788600000000–1788600000007) and 5 ' +
      '*.db-spec.ts files, excluded from rules 2–4; both counts grow with ordinary schema ' +
      'work, unrelated to this table, and this row does not track or re-check its own prose.',
    blindSpot:
      'Compares TEXT, not schema semantics: two migrations that are each individually ' +
      "well-formed but logically conflict (an `up()` that doesn't undo cleanly in its own " +
      "`down()`, two migrations that each assume the other's column) are both green — " +
      "whether a migration is CORRECT, or even runs, is test:db's job, never this row's. " +
      'Rule 4 cannot see a migration authored and then edited within the SAME pull request ' +
      'as its own creation: it only ever compares against whatever origin/main already ' +
      "has, so anything that happens before that ref updates is invisible to it — and rule " +
      "4's whole guarantee is only as strong as origin/main being fetched; when that ref " +
      'does not resolve, rule 4 is SKIPPED (a WARNING line, never a silent pass) and this ' +
      'row proves nothing about already-merged migrations for that run, though rules 1–3 ' +
      'still apply in full. Filename- and class-name-matching are purely lexical: a ' +
      'correctly named class with a broken body is exactly as green as a correct one.',
  },
  {
    id: 'selfcheck',
    tier: 'fast',
    cmd: 'npm run test:verify',
    // No `after`: nothing this suite does depends on another row having passed first.
    // It runs the layer's own .mjs sources directly under node:test — untranspiled,
    // untyped at runtime — so a failure or a pass in `typecheck` changes nothing about
    // whether these tests execute or what they observe; and it does not read `lint`,
    // `testfiles`, `secrets`, `seam` or `migrations` output, only the source files those
    // commands also happen to run. `run.mjs` runs every row strictly sequentially (a
    // `for` loop that `await`s each `runCommand` before starting the next — see
    // run.mjs's main()), so the handful of these tests that write and delete fixture
    // files under backend/src (each wrapped in try/finally) never overlap with another
    // row's own read of that tree.
    proves:
      "A single failing assertion anywhere in the verify layer's own `*.test.mjs` suite " +
      'fails this exact command and turns this row red, independent of how many tests ' +
      'exist when it runs — which is the whole point of adding it: before this row ' +
      'existed, `npm run verify` ran eight other rows ' +
      'over the rest of the tree — including `typecheck`, which covers scripts/**/*.mjs ' +
      'for TYPES, and `testfiles`, which confirms this layer\'s own *.test.mjs files ' +
      'are COLLECTED, by node-test specifically — and not one of them RAN this suite, so ' +
      'broken logic inside any check (a ratchet that silently stopped ratcheting, a boundary scan that ' +
      'stopped finding boundaries) could stay green in `npm run verify` indefinitely, ' +
      'caught only by someone remembering to run `npm run test:verify` by hand. ' +
      "AS A SNAPSHOT, MEASURED 2026-09-10 and re-measured the same day after Task 10 added " +
      "`ratchets/lint-exempt.test.mjs`: `npm run test:verify` (`node --test " +
      "--test-concurrency=1 'scripts/verify/**/*.test.mjs'`) collects and runs 78 tests " +
      "across 9 *.test.mjs files today — hash.test.mjs (7), registry.test.mjs (8), " +
      'run.test.mjs (14), checks/memo-drift.test.mjs (4), ' +
      'checks/migration-invariants.test.mjs (8), checks/seam-boundary.test.mjs (13), ' +
      'checks/secret-boundary.test.mjs (13), checks/test-glob-parity.test.mjs (3) and ' +
      'ratchets/lint-exempt.test.mjs (8) — up from the 70-across-8-files ' +
      'this row first shipped with, and due to grow again the next time this plan adds a ' +
      'check. This row does not track or re-check its own prose count.',
    blindSpot:
      "Proves only that each check's tests still agree with that check's code today — " +
      'self-consistency, not correctness of what the check was designed to catch. A ' +
      "check's tests are written by whoever wrote the check, in the same sitting, so a " +
      "blind spot baked into the check's own design (a boundary its author never " +
      'considered, a rule that was always narrower than the prose above it claims) is ' +
      'exactly as invisible to that check\'s tests as it is to the check itself — this ' +
      'row cannot distinguish a check that is correct from one that is confidently, ' +
      'consistently wrong in a way its own author never tested for. It says nothing about ' +
      'whether any `proves` or `blindSpot` string in this very registry, including this ' +
      "one, is actually TRUE of its check: a `proves` sentence could overstate what its " +
      'command establishes, or understate a blind spot, and every test in this row could ' +
      'still be green, because this row exercises the CODE the other checks run, never ' +
      "the PROSE describing them — auditing that prose against the registry is `memo`'s " +
      'job, and `memo` only confirms CLAUDE.md quotes this file verbatim, never that a ' +
      'quoted claim is honest. And a green here says nothing about a check this layer ' +
      "does not yet have — a future crate_issuances or cash_counts boundary check, say — " +
      'until both that check and its tests exist.',
  },
  {
    id: 'ratchet:lint-exempt',
    tier: 'fast',
    cmd: 'npm run lint:exempt',
    // No `after`: this check never invokes eslint (npm run lint) or tsc — it reads
    // backend/src, frontend/src and the two eslint.config.mjs files itself with a
    // line-oriented text scan (scripts/verify/ratchets/lint-exempt.mjs), the same
    // "parse the tree directly, don't shell out to the tool" stance `seam` and
    // `migrations` already take toward tsc. A red `lint` row changes nothing about what
    // this row can see: it is exactly as blind to whether a suppressed rule is currently
    // VIOLATED as it is to whether the rule exists in either config at all — it only
    // ever asks "is every exemption accounted for," never "is eslint happy."
    proves:
      'Every lint exemption this scan finds — an eslint-disable/-disable-line/-disable-' +
      'next-line/-enable directive comment anywhere in backend/src or frontend/src, or an ' +
      "`ignores`-property occurrence or a rule pinned to 'off' in either flat " +
      'eslint.config.mjs — must match a dated, ≥30-character-reasoned entry in ' +
      'scripts/verify/baselines/lint-exempt.json, key for key, or this exact command fails. ' +
      'THIS IS THE FIRST TRUE RATCHET IN THIS LAYER: the comparison runs in BOTH ' +
      'directions, and both are provable by this exact command failing, independent of how ' +
      'many exemptions exist. A NEW exemption ' +
      'anywhere in the scan that is not yet in the baseline fails it (`git ls-files -c -o ' +
      '--exclude-standard` means an untracked, freshly written one counts too). A baseline ' +
      'entry whose exemption NO LONGER EXISTS in the code or config also fails it — a stale ' +
      'forgiveness must be deleted, never left standing, or the baseline only ever grows. ' +
      'And a baseline entry whose `reason` is missing, `TODO`, or under 30 characters after ' +
      'trimming fails the command on the baseline alone, before either direction of that ' +
      'comparison ever runs. AS A SNAPSHOT, MEASURED 2026-09-10: `npm run lint:exempt` ' +
      'finds exactly 13 lint exemptions today — 10 directive comments (9 disable-type, ' +
      "plus the one eslint-enable that closes test-setup.ts's block disable) and 3 " +
      "`ignores`-property occurrences bundling 7 individual globs, with zero rules pinned " +
      "to 'off' in either config. That count moves the instant anyone adds or removes an " +
      'exemption anywhere in the scan, and this row does not track or re-check its own ' +
      'prose.',
    blindSpot:
      'Counts lint suppressions; it does not, and cannot, judge whether any one of them is ' +
      'justified — a reason that reads as 30-plus characters of plausible prose passes ' +
      'exactly as well as one that is actually true, because nothing here re-derives WHY a ' +
      'rule does not apply, only that someone wrote a reason down. A rule that was never ' +
      'enabled in either flat config needs no exemption and stays invisible here — this row ' +
      'proves nothing about the coverage of the rule set itself, only about what is exempted ' +
      'from whatever rules do run today. And because a key embeds the exact line number, an ' +
      'exemption comment or an `ignores` property that merely MOVES to a different line — a ' +
      'reformat, an unrelated edit two lines above it — looks to this check exactly like one ' +
      'exemption removed plus a new one added, even though what it actually suppresses never ' +
      'changed; the same is true, compounded, of a bundled `ignores` entry, where adding or ' +
      'removing even ONE glob from a multi-glob line changes the whole line\'s key.',
  },
  {
    id: 'ratchet:money',
    tier: 'fast',
    cmd: 'npm run ratchet:money',
    // No `after`: this check never invokes tsc, only `ts.createSourceFile` — a syntax-only
    // parse, same access route `seam` and `migrations` already take. Verified empirically
    // 2026-09-10 the same way `migrations` documents: a fixture combining a genuine type
    // error (`const notANumber: number = "this is a type error"`) with a genuine arithmetic
    // finding (`brokenParam * 2`, `brokenParam` a function, not a number) in the same file
    // made `npx tsc -p backend/tsconfig.json --noEmit` fail with two TS errors while `npm
    // run ratchet:money` still parsed the file and reported the `*` finding correctly — a
    // type error neither hides nor fakes a finding here, so an `after: ['typecheck']` would
    // order two rows that do not actually depend on each other.
    proves:
      'Every `*`/`/` BinaryExpression, `Number()`/`parseInt()`/`parseFloat()` call, and ' +
      '`.toFixed` MemberExpression this scan finds in backend/src/**/*.ts — outside ' +
      'src/intakes/, src/payouts/, src/shifts/, src/supplier-balance/ (already eslint\'s ' +
      'territory per the `lint` row) and outside *.spec.ts/*.db-spec.ts — is either ' +
      'PROVABLY NON-MONETARY (every operand is a numeric literal, or an identifier declared ' +
      'in the SAME FILE with an explicit `number` type or a numeric-literal initialiser) or ' +
      'matches a dated, reasoned entry in scripts/verify/baselines/money-rounding.json at ' +
      'its EXACT occurrence count, key for key (file:line:kind), or this exact command ' +
      'fails. The comparison runs in both directions, same as ratchet:lint-exempt: a NEW ' +
      'site not yet in the baseline fails it, and a baseline entry whose exact count no ' +
      'longer matches the tree — including a count that dropped to zero — fails it too, so ' +
      'a stale entry must be deleted rather than left standing; a partial fix (two of three ' +
      'sites cleaned up) is exactly as red as no fix at all. `Number`, `parseInt` and ' +
      '`parseFloat` are resolved by BINDING, not by name alone: a file that locally ' +
      'declares or imports something under one of those three exact names is calling that ' +
      'local, not the global this row bans, and such a call is skipped entirely rather than ' +
      'mistaken for the real one. AS A SNAPSHOT, MEASURED 2026-09-10: the baseline holds 29 ' +
      'keys / 32 occurrences — 10 are the repeated `(page - 1) * limit` pagination-offset ' +
      'arithmetic this template\'s list endpoints share (including ' +
      'common/dto/pagination-query.dto.ts\'s own skipOf() helper), 4 are ' +
      'backend/src/common/money.ts\'s OWN bigint internals (the seam itself, audited by ' +
      'money.spec.ts, not by this AST heuristic), 6 are config/env-var integers (ports, the ' +
      'throttle window and limit) parsed with parseInt()/Number(), 1 is ' +
      'redis.module.ts\'s reconnect backoff and 1 is media.constants.ts\'s upload-size ' +
      'constant, 4 are password-hashing.ts\'s scrypt cost-parameter parsing and memory ' +
      'sizing, and 3 are backend/src/seed/dev-seed.ts\'s OWN independent reimplementation ' +
      'of money.ts\'s add() — a real duplicate of the one authorised rounding seam, ' +
      'confined to the dev-only seed script, left as-is because backend/src was out of ' +
      'scope for the task that wrote this row. That count moves the instant anyone adds, ' +
      'removes, or clears an arithmetic site anywhere in the scan, and this row does not ' +
      'track or re-check its own prose.',
    blindSpot:
      'Nothing about whether the arithmetic is RIGHT — money.ts\'s own mul(a, b) and a ' +
      'hand-rolled a * b elsewhere are scored identically by this row: it checks whether a ' +
      'value is routed through a shape this heuristic recognises as safe, never whether the ' +
      'resulting figure is the correct one. Type information comes from the TypeScript ' +
      'SYNTAX of the single file being parsed (ts.createSourceFile), never from the type ' +
      'checker: a monetary string arriving through a function parameter or return type ' +
      'declared in ANOTHER file reads as an untyped identifier here, clears neither cover ' +
      'rule, and lands in the baseline as a finding rather than being resolved and either ' +
      'caught or correctly cleared — part of why 10 of the baseline\'s 29 keys are the ' +
      'ordinary (page - 1) * limit idiom repeated at every list endpoint rather than ' +
      'something this row could recognise once and ignore everywhere after. And a value ' +
      'computed into an intermediate variable and only later formatted or multiplied on a ' +
      'DIFFERENT statement is invisible to the per-node operand check this row runs — it ' +
      'inspects only the immediate two operands of one BinaryExpression, one call\'s ' +
      'arguments, or one member access\'s object, never a variable\'s provenance a ' +
      'statement or a scope away (see password-hashing.ts:28\'s baseline entry, where the ' +
      'same limitation misses that a chained 32 * 1024 * 1024 is entirely literal, because ' +
      'the OUTER multiplication\'s left operand is itself a BinaryExpression, not a bare ' +
      'literal or identifier). And its reach is exactly backend/src\'s *.ts files parsed as ' +
      'ts.ScriptKind.TS — there are no .tsx files there today, but this row would need ' +
      'revisiting before one outside the four eslint-scoped trees could be trusted.',
  },
  {
    id: 'ratchet:persist',
    tier: 'fast',
    cmd: 'npm run ratchet:persist',
    // No `after`: this check never invokes tsc, only `ts.createSourceFile` — a syntax-only
    // parse, the same access route `seam`, `migrations` and `ratchet:money` already take
    // (and the same reasoning `ratchet:money`'s own `after` comment states in full: a type
    // error does not stop a file from parsing, so ordering this after `typecheck` would pair
    // two rows that do not actually depend on each other).
    proves:
      'Every `localStorage`/`sessionStorage` member access under frontend/src — a direct ' +
      '`localStorage.x`/`sessionStorage.x`, or `window.localStorage.x`/`window.sessionStorage.x` ' +
      '— sits inside a `try`/`catch`; every value a `getItem()` call on one of those returns ' +
      'reaches app state only through `typeof`, `Array.isArray`, `in`, `instanceof`, a ' +
      '`.parse(` call, or a local `x is T` type-predicate function DECLARED IN THE SAME FILE ' +
      '(never a bare `as`/`<T>` cast, and never left unguarded when the enclosing function\'s ' +
      'own declared return type is narrower than the `string | null` `getItem()` actually ' +
      'returns); and the string literals `isPersistableKey` (found anywhere under ' +
      'frontend/src by name, not hard-coded to one path) checks a key against equal ' +
      'scripts/verify/baselines/persist-boundary.json\'s entries, key for key, in BOTH ' +
      'directions — a new key is red, and a baseline entry with no matching literal left in ' +
      'the tree is red too. A violation of any of the three, anywhere the scan reaches, fails ' +
      'this exact command. Parsed with the TypeScript compiler API, `.tsx` files under ' +
      '`ts.ScriptKind.TSX` and `.ts` files under `ts.ScriptKind.TS` — never a regex, and never ' +
      'the wrong script kind silently mis-parsing JSX. AS A SNAPSHOT, MEASURED 2026-09-10: ' +
      'frontend/src holds FIVE files that touch storage this way, not the four spec ground ' +
      'names — entities/user/model/store.ts (the bearer token), shared/api/persister.ts (the ' +
      'TanStack query cache), shared/lib/form-draft/draftStorage.ts (raw form drafts), ' +
      'shared/lib/i18n/language-preference.ts and shared/lib/theme/theme-preference.ts (found ' +
      'by this task\'s own grep, narrowed the identical way language-preference.ts is) — 10 ' +
      'guarded accesses and 4 getItem() reads (persister.ts\'s own reads are internal to the ' +
      'TanStack library this file only configures, so it contributes zero directly-visible ' +
      'getItem calls), and isPersistableKey\'s allowlist holds exactly one key, `me`. ' +
      'frontend/src/test-setup.ts (vitest\'s global setup file, wired by vite.config.ts\'s ' +
      'test.setupFiles and imported by nothing else) is excluded from this scan by exact ' +
      'path: its unguarded `localStorage.clear()`/`sessionStorage.clear()` never ship in the ' +
      'production bundle and run only under jsdom, which does not exhibit the private-' +
      'browsing throw this row exists to catch — the same class of file-role scope decision ' +
      '`ratchet:money` already makes excluding `*.spec.ts`/`*.db-spec.ts`, not a baseline entry ' +
      'forgiving a violation in one of the five real boundary files. That count and file list ' +
      'grow or shrink with ordinary feature work, and this row does not track or re-check its ' +
      'own prose.',
    blindSpot:
      'It proves the SHAPE of a guard, never that the guard is correct: `Array.isArray(x)` ' +
      'satisfies the narrowing rule and says nothing about what is inside the array, and a ' +
      'value that clears `isSupported(v)` is trusted completely from that point on even if ' +
      'the predicate itself is wrong. A local type-predicate function must be DECLARED IN THE ' +
      'SAME FILE as the read it narrows — a predicate imported from elsewhere cannot be ' +
      'confirmed from the AST at all, so a read narrowed that way reads as UNNARROWED (a real ' +
      'narrowing reported as absent), never as silently accepted. Rule 1 recognises the ' +
      'storage object only BY NAME (`localStorage`/`sessionStorage`/`window.localStorage`/' +
      '`window.sessionStorage`): a reference obtained through an intermediate variable ' +
      '(`const s = window.localStorage; s.getItem(...)`) is invisible to it in both ' +
      'directions — neither flagged unguarded nor credited as guarded — which is also, ' +
      'precisely, why persister.ts\'s own `safeStorage(read: () => Storage)` (whose header ' +
      'comment states outright that the thunk exists so "the getter access itself happens ' +
      'inside the try") reports zero access sites here rather than being confirmed safe: its ' +
      'reads happen through a local `storage` variable this row never resolves back to the ' +
      'global. Rule 2\'s "opaque passthrough" exemption (a bare, uncast `return x.getItem(...)`, ' +
      'or a local variable never cast and never used structurally) has no live counterpart in ' +
      'the current tree failing it, so its coverage rests on this row\'s own fixture tests, ' +
      'not on a real finding it has caught. And frontend/src/test-setup.ts is excluded by ' +
      'exact path — a second such test-harness file elsewhere would need its own named ' +
      'exclusion before this row would stop reporting it, since nothing here recognises "this ' +
      'is test infrastructure" except that one hard-coded path.',
  },
  {
    id: 'deadcode',
    tier: 'fast',
    cmd: 'npm run deadcode',
    // No `after`: unlike ratchet:money/ratchet:persist/seam/migrations (a syntax-only
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
      'Every knip finding across this npm-workspaces monorepo — run as `./node_modules/.bin/knip --reporter ' +
      'json` from the repo root, covering both the backend and frontend workspaces knip.json declares — is ' +
      'either accounted for by an exact-key entry in scripts/verify/baselines/dead-exports.json or fails this ' +
      'exact command, in BOTH directions: a new finding is red, and a baseline entry knip no longer reports is ' +
      'ALSO red, so the stale entry must be deleted rather than left standing (this is the layer\'s second true ' +
      'ratchet, same discipline as ratchet:lint-exempt). Three things a bare `knip` run cannot enforce are ' +
      'closed alongside it, each verified against this exact installed knip (6.35.1): (1) knip.json is held to ' +
      'an ALLOW-LIST of exactly `$schema`/`workspaces` at the top level and `entry`/`project` inside each ' +
      'workspace — checked directly against node_modules/knip/schema.json, which lists eighteen top-level and ' +
      'eleven per-workspace keys beyond those (ignore, ignoreDependencies, ignoreExportsUsedInFile, ' +
      'ignoreBinaries, ignoreWorkspaces among them) — plus a second knip config file (knip.jsonc/.ts/.js/.mjs/' +
      '.cjs/.knip.json(c), at the root or inside backend/frontend) or a `"knip"` section in any of the three ' +
      'package.json files knip reads it from; ANY of those fails this command by naming the offending key or ' +
      'file, before knip is even invoked. (2) knip.json\'s workspaces.*.entry/project glob values are SHA-256 ' +
      'fingerprinted into the baseline (first 16 hex chars) — changing a glob, including narrowing `project` ' +
      'or adding a `!` negation, without a matching baseline update fails this command even when every finding ' +
      'individually still matches, because a narrower glob hides findings with no banned key in sight. (3) a ' +
      '`@public`/`@internal`/`@alias`/`@beta`/`@alpha` JSDoc tag on an export is scanned for directly (a line-' +
      'oriented text scan over backend/src and frontend/src, the same idiom lint-exempt.mjs and money-' +
      'rounding.mjs already use) and fails this command by name — verified empirically that the identical ' +
      'unused, reachable export produces a finding untagged and NONE at all with `/** @public */` above it, so ' +
      "trusting knip's own JSON output alone would have missed this exact suppression vector. AS A DATED " +
      'SNAPSHOT, MEASURED 2026-09-10: the baseline holds all 120 findings knip.json\'s two workspaces produce ' +
      'today (1 dependency, 5 devDependencies, 55 exports, 31 files, 25 types, 3 unlisted) — this repo\'s dead-' +
      'code debt on that date, read and reasoned individually rather than bulk-recorded, with 14 of the 120 ' +
      "tied to decisions frontend/CLAUDE.md names explicitly (shared/lib/form-draft's file finding; the Kit-" +
      'hygiene note\'s eight named starter-UI-primitive files plus the vaul dependency that traces to one of ' +
      "them; entities/user's useUpdateMeMutation pattern-reference hook and its input type, at both origin and " +
      'barrel). That count moves the instant anyone adds, fixes, or clears a finding anywhere knip.json\'s ' +
      'globs reach, and this row does not track or re-check its own prose.',
    blindSpot:
      "knip infers reachability from its own static analysis of the module graph, and CAN BE WRONG IN BOTH " +
      'DIRECTIONS — particularly around dynamic imports (a bare `require(\'pino-pretty\')` string handed to ' +
      "a third-party transport, baselined here as unlisted, is invisible to it) and framework-invoked code " +
      "(a NestJS provider wired only through a decorator and DI, or a *.db-spec.ts file this task's own " +
      "investigation found `backend/jest.db.config.js` runs directly, that knip's Jest plugin cannot see " +
      "because its default spec/test glob requires a literal dot before 'spec'/'test' and never matches a " +
      "hyphenated '-db-spec.ts' suffix — 13 of this baseline's 31 file findings are exactly that one glob " +
      "mismatch, and a further 8 are TypeORM migrations the runner discovers via a directory glob at startup " +
      "rather than a static import, the same class of framework-invoked blind spot in a different tool; " +
      "neither 13 nor 8 is real dead code). A baseline entry means the finding is KNOWN and explained, never that " +
      "the code it names is ACCEPTABLE to keep as-is — recording backend/src's transitive, undeclared `ms`/" +
      "`express` imports, or frontend/src's six independently-duplicated `Paginated<T>` interfaces, documents " +
      "them for a future fix, it does not endorse them, and this task deliberately left every one of them " +
      "unfixed since backend/src and frontend/src are out of scope for it. And this row says NOTHING about " +
      "whether the LIVE code — the 99.6% of this codebase knip does NOT flag — is any good: it is silent on " +
      "correctness, duplication elsewhere, test coverage, or design, exactly as silent as `lint` is on whether " +
      "a passing type is the RIGHT type.",
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
