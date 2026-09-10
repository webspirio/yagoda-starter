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
      'Measured 2026-09-10: backend jest (NODE_OPTIONS=--experimental-vm-modules jest, ' +
      'testRegex .*\\.spec\\.ts$, rootDir src) ran 40 suites / 511 tests, and frontend ' +
      'vitest (vitest run) ran 99 files / 592 tests — 139 files and 1103 tests total, all ' +
      'passing. A single failing assertion anywhere in either workspace turns this exact ' +
      'command, and this row, red.',
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
      'Measured 2026-09-10: every one of the 156 files in this repo whose name matches ' +
      '*.{test,spec,db-spec}.[cm]?[jt]sx? is collected by exactly one of this repo\'s four ' +
      'test runners — jest-unit (40 files, backend/package.json\'s testRegex, rootDir ' +
      'src), jest-db (12 files, backend/jest.db.config.js\'s separate testRegex, also ' +
      'rootDir src), vitest (99 files, frontend\'s default include, no test.include set) ' +
      'and node-test (5 files, scripts/**/*.test.mjs, run by npm run test:verify). The two ' +
      'backend regexes are read out of backend/package.json and backend/jest.db.config.js ' +
      'at runtime, not copied here, so this row also proves those two files still say what ' +
      'the check assumes — a file with zero matching collectors, or claimed by two at ' +
      'once, fails this exact command.',
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
      'Shannon entropy is measured over the WHOLE value (a run-based measurement was tried ' +
      'and rejected: it scored a real hyphen-separated credential at 2.00 bits/char, ' +
      'comfortably invisible), but it remains a heuristic in both directions — a placeholder ' +
      'shape not yet named in PLACEHOLDER_RE can still false-positive, and any real secret ' +
      'under 32 characters is never inspected at all, full stop. Only a QUOTED string ' +
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
      'file is reported STALE). Today it holds one already-audited fake token fixture in ' +
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
      'Measured 2026-09-10: `npm run migrations:check` parses every backend/src/**/*.ts ' +
      'file with the TypeScript compiler API and enforces four rules against ' +
      "backend/src/migrations/'s 8 numbered migrations (timestamps 1788600000000– " +
      '1788600000007), its 5 *.db-spec.ts files excluded from rules 2–4 — (1) every ' +
      '`synchronize` property anywhere under backend/src initialises to the literal ' +
      '`false` (both known sites today, app.module.ts:129 and testing/db-harness.ts:126, ' +
      'and any new one); (2) every file in backend/src/migrations/ that is not one of the ' +
      '5 db-specs matches /^(\\d{13})-([A-Za-z0-9]+)\\.ts$/ — a stray file of neither shape ' +
      'is itself a finding — and no two migration filenames capture the same 13-digit ' +
      'timestamp, a fixed-width prefix so unique implies strictly ascending; (3) each migration\'s ' +
      "exported class name equals its filename's name-plus-timestamp (e.g. " +
      '1788600000000-InitialSchema.ts exports InitialSchema1788600000000, confirmed ' +
      'against all 8 files as shipped); and (4), ONLY WHEN origin/main is a resolvable ' +
      'ref, every migration file that already exists there (`git cat-file -e ' +
      'origin/main:<path>`) is byte-identical to that copy (`git diff --quiet origin/main ' +
      '-- <path>`) — a migration new since origin/main needs no comparison and stays ' +
      'green. A violation of 1–3, or of 4 whenever origin/main was reachable, fails this ' +
      "exact command; this row proves rule 4's guarantee ONLY for a run where origin/main " +
      'was fetched, and says so with a WARNING line — printed even on a passing run — ' +
      'whenever it was not.',
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
      "Measured 2026-09-10: `npm run test:verify` (`node --test --test-concurrency=1 " +
      "'scripts/verify/**/*.test.mjs'`) collects and runs all 70 tests across the verify " +
      'layer\'s 8 *.test.mjs files — hash.test.mjs (7), registry.test.mjs (8), ' +
      'run.test.mjs (14), checks/memo-drift.test.mjs (4), ' +
      'checks/migration-invariants.test.mjs (8), checks/seam-boundary.test.mjs (13), ' +
      'checks/secret-boundary.test.mjs (13) and checks/test-glob-parity.test.mjs (3), 70 ' +
      'in total — and every one of them passes. A single failing assertion anywhere in ' +
      'that suite fails this exact command and turns this row red, which is the whole ' +
      'point of adding it: before this row existed, `npm run verify` ran eight other rows ' +
      'over the rest of the tree — including `typecheck`, which covers scripts/**/*.mjs ' +
      'for TYPES, and `testfiles`, which confirms this layer\'s own 8 *.test.mjs files ' +
      'are COLLECTED, by node-test specifically — and not one of them RAN this suite, so ' +
      'broken logic inside any check (a ratchet that silently stopped ratcheting, a boundary scan that ' +
      'stopped finding boundaries) could stay green in `npm run verify` indefinitely, ' +
      'caught only by someone remembering to run `npm run test:verify` by hand.',
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
