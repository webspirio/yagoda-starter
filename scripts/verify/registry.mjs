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
      'tsc reports zero type errors across every project the typecheck command spans: ' +
      'backend (tsc -p tsconfig.json --noEmit, strict mode, over everything under ' +
      'backend/src including *.spec.ts and *.db-spec.ts — there are no backend .ts files ' +
      'outside src/), frontend (tsc -b, building tsconfig.app.json over src/ and ' +
      'tsconfig.node.json over vite.config.ts), the verify layer itself (tsc -p ' +
      'tsconfig.scripts.json, checkJs, over scripts/**/*.mjs and .claude/hooks/**/*.mjs), ' +
      'and, as of Task 17, the Playwright e2e suite (tsc -p tsconfig.e2e.json, strict, over ' +
      'playwright.config.ts and e2e/**/*.ts — the config that drives `smoke` and the setup/' +
      'teardown/spec files it loads). A type error in any one of those FOUR projects fails ' +
      'this exact command.',
    blindSpot:
      'Nothing about runtime data: a field typed as a plain string accepts any string tsc ' +
      'never inspects the value of, and every `as` cast and non-null assertion (`!`) is a ' +
      'hole this row does not look through. JSON parsed from a database row, an HTTP body ' +
      'or a JWT payload is trusted at the type boundary, not verified. And its reach is ' +
      'exactly the four tsconfig files above: a file none of their include/exclude rules ' +
      'reaches is not type-checked by this row at all.',
  },
  {
    id: 'test',
    tier: 'fast',
    cmd: 'npm test',
    // 1445 tests across two workspaces. Warm on a laptop this is ~27s and CI's first run
    // of it blew through 120s with an empty Turbo cache — see the timeoutMs note above.
    timeoutMs: 600_000,
    proves:
      'A SNAPSHOT, RE-MEASURED 2026-09-18 on main after PR #111 (the #11 password vault) ' +
      'landed alongside the verify layer (192 files / 1657 tests on 2026-09-16, 178 files / ' +
      '1445 tests on 2026-09-15, 99 files / 592 tests on 2026-09-11 ' +
      '— see CLAUDE.md\'s Verification section for the same discipline applied to cost ' +
      'figures): backend jest (NODE_OPTIONS=--experimental-vm-' +
      'modules jest, testRegex .*\\.spec\\.ts$, rootDir src) ran 56 suites / 754 tests, and ' +
      'frontend vitest (vitest run) ran 138 files / 941 tests — 194 files and 1695 tests ' +
      'total today, all passing. Those counts grow with ordinary feature work in either ' +
      'workspace and are not re-verified by this row — they illustrate scale, nothing more. ' +
      'The INVARIANT this row actually enforces outlives every one of them: a single ' +
      'failing assertion anywhere in either workspace turns this exact command, and this ' +
      'row, red, no matter how many tests exist when it runs.',
    blindSpot:
      'The backend testRegex matches only *.spec.ts, so all 30 *.db-spec.ts suites ' +
      '(backend/jest.db.config.js, a separate config) are excluded from this row entirely ' +
      '— test:db is what covers those. No .tsx file is exercised by the backend suites: ' +
      'the backend has no .tsx files, and only the frontend vitest half of this row ever ' +
      'touches one. And this row cannot see assertion strength: a test that calls a ' +
      'function and asserts nothing about the result is exactly as green as one that ' +
      'checks the answer. AS OF 2026-09-15 THIS ROW DOES NOT RUN AT ALL IN A FULL-TIER RUN: ' +
      "`coverage` declares `supersedes: ['test']` and runs the identical suites under " +
      'instrumentation in its place, so `npm run verify:full`, `npm run verify:ci` and CI ' +
      'never execute this bare command there. `coverage` still catches a test that passes ' +
      'bare and fails instrumented — its own proves says so — and what nothing catches in ' +
      'those runs is the OPPOSITE case: a test that would fail bare and passes only because ' +
      'instrumentation is loaded. `npm run verify` (fast tier) and the pre-push gate, which ' +
      'excludes `coverage`, are the two places this exact command still runs.',
  },
  {
    id: 'test:ci-scripts',
    tier: 'fast',
    cmd: 'npm run test:ci-scripts',
    needs: ['jq'],
    // No `after`: neither suite reads any other row's output, and both fake their own
    // `curl`/PATH fixtures from scratch on every run.
    proves:
      '`npm run test:ci-scripts` (`for f in scripts/ci/*.test.sh; do bash "$f" || exit 1; ' +
      'done`) exits 0 only when EVERY `scripts/ci/*.test.sh` file is fully green — a real ' +
      'shell glob, not an enumerated list of the two filenames that happen to exist today, ' +
      'and deliberately so: an earlier version of this row named the two suites directly, ' +
      'which meant a THIRD such file could be reported "collected by exactly one runner" by ' +
      "`testfiles`' shell-test collector (also `scripts/ci/*.test.sh`) while this row never " +
      'ran it at all — collector and runner agreeing on the same glob is what makes either ' +
      "one's claim true; a by-name runner behind a by-suffix collector is exactly the class " +
      'of gap this whole layer exists to close, one level up from where it was first found. ' +
      'Today that glob still resolves to the same two files: coolify-deploy.test.sh fakes ' +
      '`curl` and drives ' +
      'scripts/ci/coolify-deploy.sh through seven scenarios (a happy-path deploy; a ' +
      'Coolify-reported failure; a finished deployment serving the wrong commit; a production ' +
      'deploy with no PR number and so no seed login; a non-JSON 502 poll body that must not ' +
      'kill the script silently under `set -euo pipefail`; a version mismatch that must be ' +
      'retried, not asserted once; and a failed deployment whose log is linked, never echoed, ' +
      'so a secret inside it is never printed) and prints its own `passed=N failed=0` summary, ' +
      'asserted separately (`[ "$fail" -eq 0 ]`) so a `check` call that silently never ran ' +
      'cannot still read as green. ghcr-cleanup.test.sh drives scripts/ci/ghcr-cleanup.sh ' +
      'through five scenarios against a nine-version GHCR fixture — package selection (an ' +
      'open-PR alias and a fresh sha tag kept, a closed-PR-only version and a stale sha-only ' +
      'version deleted); a 404ing package skipped rather than aborting the whole run; a ' +
      'non-404 API failure (an expired token, a missing permission) failing loud instead of ' +
      'being swallowed like a 404; the `KEEP_RECENT_SHA` floor protecting every sha-tagged ' +
      'version from age-based deletion; and every package 404ing being diagnosed as the wrong ' +
      'GHCR URL shape (a personal account is /users/<name>/…, not /orgs/…) rather than a ' +
      'silent no-op — each printing its own `<name>: ok` line, with the whole script exiting ' +
      'non-zero the instant any one of the five fails (an explicit `exit 1`, or `set -e` ' +
      'propagation from a failed assertion). AS A DATED SNAPSHOT, RE-MEASURED 2026-09-15 ' +
      '(run via `npm run test:ci-scripts` with a real `jq` binary placed on PATH for the ' +
      'measurement — this machine has no system-installed jq; the script\'s own ' +
      'header also documents a Docker/Alpine one-liner as an alternative — see the `jq` ' +
      'precondition below): coolify-deploy.test.sh ' +
      'reported `passed=20 failed=0` and ghcr-cleanup.test.sh\'s all five scenarios (select, ' +
      'guard, fail-loud, floor, all-404) printed `: ok`, both suites exiting 0 — identical ' +
      'to 2026-09-11, as it must be: main\'s 156 commits touched no file under scripts/ci/. ' +
      'THE "REAL BINARY" QUALIFIER IS LOAD-BEARING and was demonstrated the same day: the ' +
      'first attempt used a `docker run --rm -i ghcr.io/jqlang/jq` WRAPPER on PATH, and ' +
      'coolify-deploy.test.sh reported `passed=19 failed=1` — scenario 6 (a version ' +
      'mismatch must be RETRIED, not asserted once) saw only one poll instead of two, ' +
      'because the suite runs the deploy script under READY_TIMEOUT_SEC=5 and a ' +
      'container-per-call jq burns that budget in a single iteration. Re-run with the jq ' +
      'binary extracted from that same image onto the host, the identical suite is ' +
      '20/0. A timing-sensitive scenario like that one does not distinguish a slow ' +
      'environment from a broken script, and this row cannot either. The glob ' +
      'itself was proven too, not just described: a throwaway, deliberately failing ' +
      'scripts/ci/zz.test.sh made this exact command exit 1 with zz.test.sh\'s own output ' +
      'printed, then a clean re-run after deleting it exited 0 again. RULING R16: ' +
      'the invariant this row enforces is that both suites keep exiting 0 on every run, not ' +
      'that they hold any particular count of scenarios — the dated snapshot above is scale, ' +
      'nothing more, and a future scenario added to either suite is not re-verified by this ' +
      'prose.',
    blindSpot:
      "Proves the two suites keep passing; it does not audit whether either suite's OWN " +
      'coverage is complete — a Coolify or GHCR API behaviour neither suite fakes is exactly ' +
      'as invisible to this row as it always was under the old `checks` job. Neither suite ' +
      'ever talks to a real Coolify instance or the real GHCR API: every HTTP call is ' +
      "intercepted by the fake `curl` binary each suite installs onto its own throwaway PATH, " +
      'so a real endpoint accepting a spec-shaped-but-untested response, or a real GHCR ' +
      'pagination edge this row\'s fixture never constructs, is not exercised. This row ' +
      'requires `jq` on PATH (the `jq` precondition below) but does not separately probe for ' +
      '`bash` itself — every environment this layer otherwise assumes, this task\'s own ' +
      'machine and GitHub\'s `ubuntu-latest` runner alike, already ships bash, so a bashless ' +
      'PATH would fail this row outright rather than SKIP it, a gap this row shares with every ' +
      'other row in this registry that shells out. A machine with no jq installed — this ' +
      "task's own machine, until it either installs one or runs the Alpine container the " +
      "script's own header documents — SKIPS this row rather than running it, so a green `npm " +
      'run verify` on such a machine proves nothing about either suite there; CI never skips ' +
      'it, since GitHub\'s `ubuntu-latest` image ships jq preinstalled. And this row proves ' +
      "only that the two suites PASS — that they are still being COLLECTED and RUN at all, on " +
      'a future commit that might delete or rename either `.test.sh` file outright, is ' +
      "testfiles' job (see that row's new shell-test collector), not this one's.",
  },
  {
    id: 'testfiles',
    tier: 'fast',
    cmd: 'npm run test:files',
    proves:
      "Every one of this repo's *.{test,spec,db-spec}.[cm]?[jt]sx? files, PLUS every " +
      '*.test.sh file anywhere in the repo (a second, separate candidate net — see ' +
      'test-glob-parity.mjs\'s SHELL_TEST_FILE), is collected by EXACTLY ONE of this ' +
      "repo's six test runners — jest-unit " +
      "(backend/jest.config.js's testRegex, rootDir src — moved out of backend/package.json's " +
      "own \"jest\" key by Task 20 so coverageThreshold there could read process.env, a static " +
      "JSON block cannot), jest-db (backend/jest.db.config.js's " +
      "separate testRegex, also rootDir src), vitest (frontend's default include, no " +
      "test.include set), node-test (the positional globs of package.json's own " +
      'test:verify script, READ AT RUNTIME rather than copied — it used to say ' +
      'scripts/**/*.test.mjs, which is wider than the runner and let a .test.mjs under ' +
      'scripts/ci/ read as collected while nothing ran it), ' +
      'playwright (e2e/**/*.spec.ts, Playwright\'s own default testMatch, run ' +
      "by npm run test:e2e) and, as of Task 21, shell-test (the iteration globs of " +
      "package.json's test:ci-scripts, also read at runtime — the prefix test it replaces " +
      'recursed where a POSIX * does not) — a file with zero matching collectors, or ' +
      'claimed by two at once, fails this exact command, no matter how many files exist when ' +
      'it runs. Task 21 added shell-test after a whole-branch review found, BY HAND, that ' +
      'this check could not see scripts/ci/*.test.sh files at all: origin/main\'s `checks` job ' +
      'ran both of them with a bare shell line the old CANDIDATE_FILE regex\'s [cm]?[jt]sx? ' +
      'extensions could never match, so a `checks` job deleted out from under that line would ' +
      'have silenced both suites with nothing here noticing. The two backend regexes are read ' +
      'out of backend/jest.config.js and backend/jest.db.config.js at runtime, not copied ' +
      'here, so this row also proves those two files still say what the check assumes. AS A ' +
      'SNAPSHOT, RE-MEASURED 2026-09-18 on main after PR #111 (the #11 password vault) ' +
      'landed alongside the verify layer (239 files on 2026-09-16, 219 on 2026-09-15, 170 ' +
      'on 2026-09-11): 242 files ' +
      'now match across the two candidate nets (jest-unit 57, jest-db 30, vitest 138, ' +
      'node-test 14, playwright 1, shell-test 2). All 3 new files came from that one PR — ' +
      'users/secret-box.spec.ts, migrations/user-password-vault.db-spec.ts and ' +
      'shared/ui/password-input.test.tsx, one per collector across all three workspaces — ' +
      'no collector was added or changed by this re-measurement, ' +
      'and the six are the same six. That total grows every time ordinary feature work adds ' +
      'a test file, and this row does not track or re-check its own prose count.',
    blindSpot:
      'Nothing about the tests themselves: a file collected by exactly one runner can ' +
      'still assert nothing, or assert the wrong thing — this row only proves each ' +
      'candidate file is picked up once, never that it runs correctly, or at all, once ' +
      'collected. Its candidate patterns are *.{test,spec,db-spec}.* in the [cm]?[jt]sx? ' +
      'extensions, plus *.test.sh anywhere (the shell-test net Task 21 added); a file that ' +
      'looks like a test under any OTHER name or extension — a *.test.py, a *_test.go, a ' +
      'bare test-something.sh with no .test. segment — is invisible to it on both sides, ' +
      'reported as neither an orphan nor a false double-collection, exactly the same blind ' +
      'spot Task 21 closed for .test.sh specifically, left open for every other shape. And ' +
      'it knows only the six runners this repo has today; a seventh collector added later ' +
      'is unseen by this row until this row is taught about it — precisely how it was ' +
      'taught about playwright (the fifth, Task 17) and shell-test (the sixth, Task 21).',
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
      'characters is never inspected at all, full stop. THE OTHER DIRECTION IS LOAD-BEARING, ' +
      'not hypothetical: `PLACEHOLDER_RE` (`/^(changeme|change-me|example|your-|<.*>|\\.\\.\\.)' +
      '/i`) is anchored only at the START — there is no trailing `$` — so it matches as a ' +
      'PREFIX, not a whole-value shape. A value that merely BEGINS with one of these six ' +
      'tokens is exempted from the entropy test in its entirety, no matter what real, ' +
      'high-entropy material follows that prefix — `changeme-<a genuine 40-character ' +
      'production secret>` is exactly as invisible to rule 3 as a bare `changeme` is, with ' +
      'no warning printed either way, because this is a false NEGATIVE: the check simply ' +
      'never flags it, not a wrong classification of something it did look at. This is not ' +
      'theoretical for this exact repository: the `verify` job in .github/workflows/ci.yml ' +
      'sets `JWT_SECRET: changeme-ci-only-jwt-secret-0123456789abcdef` — a value this check ' +
      'never scrutinises past its first eight characters, for precisely this reason. That ' +
      'specific line is safe only because it genuinely is a throwaway CI fixture nothing ' +
      'outside that job verifies, not because this check confirmed anything about it; a real ' +
      'production credential typed with a `changeme-`, `example-`, `your-` or `<...>`-shaped ' +
      'prefix — whether by a copy-pasted convention or a deliberate attempt to look like a ' +
      'placeholder — would be silently invisible to rule 3 (and to rule 4\'s identical ' +
      'placeholder gate over .env.example) in exactly the same way. Shannon entropy is ' +
      'measured over ' +
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
      'file is reported STALE). As a snapshot, 2026-09-11, it holds TWO already-audited ' +
      'fake fixtures — a count that can only grow by a reviewed, dated addition to ' +
      'that array, never as an unnoticed side effect: one in ' +
      'frontend/src/shared/api/persister.test.ts (a fixture JWT), pinned by its EXACT file ' +
      'path AND its EXACT string, and one added by Task 21\'s merge of origin/main in ' +
      'docs/superpowers/plans/2026-09-09-coolify-deployment-and-cd.md (a throwaway ' +
      '`JWT_SECRET=t3-secret-...` value typed into a documented manual test run), pinned ' +
      'the identical way. Neither is a shape, a path, or a file-type carve-out. That exactness ' +
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
    // FULL, NOT FAST, since 2026-09-18, and this is containment rather than a preference.
    // This suite WRITES THE REAL WORKING TREE: it plants fixtures under backend/src and
    // frontend/src, rewrites .gitignore, .env.example, knip.json, backend/package.json and
    // both eslint.config.mjs files, stages seven paths into the real git index, edits an
    // already-merged migration, and rmSync's two TRACKED source files
    // (frontend/src/shared/lib/useIsDesktop.ts, frontend/src/test-setup.ts). Every restore
    // lives in a `finally` and nothing anywhere takes a lock.
    //
    // The Stop hook runs the fast tier after EVERY turn (.claude/hooks/stop-gate.mjs), with
    // a 150s spawnSync timeout that kills the process group — and a killed process runs no
    // `finally`. So two overlapping runs were the normal case, not an edge case, and an
    // interrupted one could leave a merged migration modified: precisely the divergence
    // rule 4 of `migrations` exists to catch.
    //
    // It is also 78% of the fast tier's wall time on its own, measured from a recorded run.
    // `.githooks/pre-push` excludes only smoke/coverage/audit, so a full-tier row JOINS the
    // push gate rather than leaving the layer, and CI's verify:ci runs the full tier.
    tier: 'full',
    cmd: 'npm run test:verify',
    // 240s, and this row is the reason the runner's default was re-examined at all. It
    // costs 67.3s cold on CI (run 35011857830) and 54.4s warm (35017224544) — against an
    // inherited 120s default nobody had ever checked it against, i.e. 1.8x, on the ONE row
    // in this registry that grows with every test the layer adds. It was around 36s when
    // that default arrived. Nothing caches `node --test`, so the number only goes up: at
    // 166 tests today it is already the largest single row in a warm CI run.
    //
    // 240s is ~3.5x the cold reading, which buys room for the growth rather than for a
    // hang. A hang here would be a test that never returns, and that is what this catches.
    timeoutMs: 240_000,
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
      "AS A SNAPSHOT, MEASURED 2026-09-15. Main's 156 commits touch no file this suite " +
      "runs, so the merge itself moved nothing here; the three tests that DID arrive on " +
      "2026-09-15 are this branch's own answers to its first real CI run and to review — " +
      "a pin on which rows carry a timeout budget, a check that a declared budget is never " +
      "shortened by --timeout-ms, and the derived-count test described at the end of this " +
      "row's blind spot (first shipped as " +
      "70-across-8-files: 78-across-9 after Task 10 added ratchets/lint-exempt.test.mjs, " +
      "and several more times since as this plan added rows — see git history for the " +
      "intermediate counts this row does not itself track): `npm run test:verify` " +
      "(`node --test --test-concurrency=1 'scripts/verify/**/*.test.mjs' " +
      "'.claude/hooks/**/*.test.mjs'` — TWO globs since Task 19, not the one this row " +
      "originally shipped quoting) collects and runs 176 tests across 14 *.test.mjs files " +
      "today, re-measured per file 2026-09-18 — hash.test.mjs (8), registry.test.mjs (12), " +
      "run.test.mjs (20), run.report.test.mjs (3), " +
      'checks/audit.test.mjs (11), checks/bundle-size.test.mjs (10), ' +
      'checks/migration-invariants.test.mjs (8), ' +
      'checks/seam-boundary.test.mjs (13), checks/secret-boundary.test.mjs (13), ' +
      'checks/test-glob-parity.test.mjs (8), ratchets/dead-exports.test.mjs (13), ' +
      
      'and .claude/hooks/stop-gate.test.mjs (14) ' +
      '— due to grow again the next time this plan adds a check. This row does not track ' +
      'or re-check its own prose count.',
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
      "ONE NARROW EXCEPTION EXISTS AS OF 2026-09-15, and its exact edge is worth knowing: " +
      "registry.test.mjs now re-derives the handful of counts in this file that a machine " +
      "CAN check — testfiles' six collector counts and their total, the migration and " +
      "migration-db-spec counts, the db-spec count quoted by test and test:db, and this " +
      "row's own *.test.mjs file count — from the same `git ls-files` net the checks " +
      "themselves use, and fails when a number quoted in a proves/blindSpot string no " +
      "longer matches the tree. It exists because review found the `coverage` row claiming " +
      "router.tsx was absent from the frontend report when it never was: false when " +
      "written, and it survived a deliberate re-measurement pass because nothing could " +
      "contradict it. That test pins NUMBERS ONLY. Every sentence around them, and every " +
      "count not derivable that way — coverage percentages, image sizes, timings, even " +
      "this row's own per-file test counts — is exactly as unchecked as before. " +
      "It says nothing " +
      "about whether any `proves` or `blindSpot` string in this very registry, including this " +
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
    id: 'deadcode',
    tier: 'fast',
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
      'SNAPSHOT, MEASURED 2026-09-10 and re-measured the same day after Task 17 (`smoke`) made `@playwright/' +
      'test` a real root devDependency (deleting the one baseline entry that named it as `unlisted`, per this ' +
      'ratchet\'s own bidirectional rule): the baseline held 119 findings knip.json\'s two workspaces produced ' +
      'that day (1 dependency, 5 devDependencies, 55 exports, 31 files, 25 types, 2 unlisted) — this repo\'s ' +
      'dead-code debt on that date, read and reasoned individually rather than bulk-recorded, with 14 tied to ' +
      "decisions frontend/CLAUDE.md names explicitly (shared/lib/form-draft's file finding; the Kit-hygiene " +
      "note's eight named starter-UI-primitive files plus the vaul dependency that traces to one of them; " +
      "entities/user's useUpdateMeMutation pattern-reference hook and its input type, at both origin and " +
      'barrel). RE-MEASURED AGAIN the same day after Task 18 added .claude/hooks/edit-lint.mjs and ' +
      '.claude/hooks/batch-typecheck.mjs: knip.json\'s two `workspaces` entries cover only backend and ' +
      'frontend, so an unconfigured root workspace still applies knip\'s own DEFAULT project glob to ' +
      'everything else the repo tracks — .claude/hooks included — and flagged both new files as unused, ' +
      'since neither is statically imported nor named in any package.json script; only .claude/settings.json\'s ' +
      'hook command line invokes them, a config-driven path knip cannot follow, the same class of blind spot ' +
      'as the migration and db-spec `file` entries already on this baseline. The baseline now holds 121 ' +
      'findings (1 dependency, 5 devDependencies, 55 exports, 33 files, 25 types, 2 unlisted). RE-MEASURED ' +
      'AGAIN the same day after Task 19 added .claude/hooks/stop-gate.mjs (the Stop-event blocking hook): ' +
      'the identical root-workspace blind spot flags it as an unused file too — only .claude/settings.json\'s ' +
      'hook command line invokes it, the same as the two Task 18 hooks. Its colocated stop-gate.test.mjs is ' +
      'NOT a new finding: it is reached through package.json\'s test:verify script, which gained a second ' +
      'glob (\'.claude/hooks/**/*.test.mjs\') for it, and knip DOES resolve a script\'s glob arguments. The ' +
      'baseline held 122 findings that day (1 dependency, 5 devDependencies, 55 exports, 34 files, 25 types, ' +
      '2 unlisted). RE-MEASURED AGAIN on 2026-09-11 after Task 21 merged 40 commits of origin/main and added ' +
      'the `jq` PRECONDITION below: the merge itself changed nothing knip reports — config/env.schema.ts (the ' +
      'Joi schema PR #63 lifted out of app.module.ts) is imported by app.module.ts and so is reachable, and ' +
      'its colocated env.schema.spec.ts is resolved by knip\'s Jest plugin as a test entry, the same as every ' +
      'other *.spec.ts file — but `execFile(\'jq\', [\'--version\'], ...)`, added to THIS file for the new ' +
      '`test:ci-scripts` row, is a real, deliberate reference to a system binary this repo declares nowhere ' +
      'in package.json, and knip\'s binaries plugin reports it as such — the first `binary`-kind finding this ' +
      'baseline has ever carried. RE-MEASURED AGAIN on 2026-09-15, after merging 156 commits of main (the ' +
      'transfers/point-cash slice, cash counts, intake top-ups #61): 33 new findings, each read at its own ' +
      'site before a reason was written, none of them deleted — backend/src and frontend/src stay out of ' +
      'scope for this layer. Four classes, three of them blind spots this baseline already documents. ' +
      'ELEVEN new *.db-spec.ts files and FOUR new TypeORM migrations: the same Jest-glob and startup-glob ' +
      'misses described below. FIFTEEN FSD public-API barrel re-exports — five mutation hooks and five ' +
      'Input types across the new transfer/cash feature slices, plus shared/lib/date\'s formatTime, ' +
      'shared/lib/money\'s CRATES_INPUT, entities/cash-count\'s two backend-mirroring unions and ' +
      'entities/point-cash\'s deliberate TransferStatus duplicate — where the SYMBOL is alive, called and ' +
      'unit-tested through its origin module, and only the one re-export line has no importer. Where a page ' +
      'test is what keeps such a symbol alive it does so by vi.mock()ing a module path, which knip does not ' +
      'resolve to a named import — but WHICH path differs per slice and is recorded per entry rather than ' +
      'claimed in general: send-transfer, resolve-transfer and set-point-target are mocked at the BARREL ' +
      'path, receive-transfer and set-cash-explanation at the ORIGIN module. Three of the fifteen ' +
      '(entities/cash-count\'s two unions and entities/point-cash\'s TransferStatus duplicate) are not ' +
      'barrel re-exports at all — they are types used inside their own declaring file and deliberately kept ' +
      'out of their entity\'s barrel. And THREE that are real debt rather than a tooling artefact: ' +
      'point-cash.service.ts\'s trailing `export { movementsSql, anchorSql, asOfSql }` has had no importer ' +
      'since the module was created — git shows the line written as `export { cashSql, ASOF }` at creation ' +
      'and renamed twice by later refactors, never once consumed. It is recorded so it is visible, not ' +
      'endorsed. RE-MEASURED 2026-09-18, the count read straight off the check\'s own output: the baseline ' +
      'holds 188 findings (1 binary, 1 dependency, 5 ' +
      'devDependencies, 78 exports, 57 files, 44 types, 2 unlisted), where this row said 156 from ' +
      '2026-09-15 until 2026-09-18. TWO of the 32 added in between are this pass\'s own, both from PR #111 ' +
      "(the #11 password vault, merged into main independently of the verify layer): that migration's file " +
      'and its *.db-spec.ts, the 14th and 30th members of two classes the blindSpot below already explains ' +
      'as framework-invoked rather than dead. The other 30 predate this pass and are NOT re-audited here — ' +
      'each still stands on its own entry\'s date and reason. That count moves the instant anyone ' +
      "adds, fixes, or clears a finding anywhere knip.json's globs reach, and this row does not track or " +
      're-check its own prose.',
    blindSpot:
      "knip infers reachability from its own static analysis of the module graph, and CAN BE WRONG IN BOTH " +
      'DIRECTIONS — particularly around dynamic imports (a bare `require(\'pino-pretty\')` string handed to ' +
      "a third-party transport, baselined here as unlisted, is invisible to it) and framework-invoked code " +
      "(a NestJS provider wired only through a decorator and DI, or a *.db-spec.ts file this task's own " +
      "investigation found `backend/jest.db.config.js` runs directly, that knip's Jest plugin cannot see " +
      "because its default spec/test glob requires a literal dot before 'spec'/'test' and never matches a " +
      "hyphenated '-db-spec.ts' suffix — 30 of this baseline's 57 file findings are exactly that one glob " +
      "mismatch, and a further 14 are TypeORM migrations " +
      "the runner discovers via a directory glob at startup rather than a static import, the same class of " +
      "framework-invoked blind spot in a different tool; and 3, as of Task 19, are .claude/hooks/*.mjs " +
      "PostToolUse hooks (edit-lint.mjs and batch-typecheck.mjs from Task 18, stop-gate.mjs from Task 19) " +
      "knip's default root-workspace scan finds but only .claude/settings.json's hook command line ever " +
      "invokes — a config-driven blind spot again, not real dead code. None of the 30, the " +
      "14, or the 3 is real dead code — together they are 47 of the 57 file findings, leaving 10 that are " +
      "ordinary frontend dead files. THESE COUNTS WERE SELF-CONTRADICTORY ON 2026-09-18 AND WERE RECOUNTED " +
      "THE SAME DAY; the mechanism matters more than the correction. The commit that re-measured this " +
      "row's \`proves\` (156 -> 188 findings, 49 -> 57 files) did not touch this blindSpot, so the row " +
      "contradicted ITSELF — proves saying 57 files while this sentence still said 49 and derived '39 of " +
      "the 49, leaving 10' from that stale figure. \`memo\` stayed GREEN throughout, because memo only " +
      "proves SKILL.md quotes this string byte-for-byte, wrong arithmetic included, and registry.test.mjs " +
      "pins only counts derivable from \`git ls-files\` — which these per-kind baseline counts are not. " +
      "Recounted directly off baselines/dead-exports.json: 57 file findings = 30 db-spec + 14 migrations " +
      "+ 3 hooks + 10 ordinary frontend dead files. The old text also called testing/db-harness.ts a 24th " +
      "finding of the same class; it is no longer a \`file\` finding at all (only three \`export\` findings " +
      "remain on it), so that clause is deleted rather than renumbered. A baseline entry means the " +
      "finding is KNOWN and explained, never that " +
      "the code it names is ACCEPTABLE to keep as-is — recording backend/src's transitive, undeclared `ms`/" +
      "`express` imports, or frontend/src's six independently-duplicated `Paginated<T>` interfaces, documents " +
      "them for a future fix, it does not endorse them, and this task deliberately left every one of them " +
      "unfixed since backend/src and frontend/src are out of scope for it. And this row says NOTHING about " +
      "whether the LIVE code — the 99.6% of this codebase knip does NOT flag — is any good: it is silent on " +
      "correctness, duplication elsewhere, test coverage, or design, exactly as silent as `lint` is on whether " +
      "a passing type is the RIGHT type.",
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
      'Every advisory `npm audit --json` reports for this npm-workspaces tree (spanning both backend and ' +
      'frontend) is recorded in scripts/verify/baselines/audit.json with a dated, real, >=30-character reason, ' +
      'or this exact command fails — CRITICAL severity is the only class that can never be baselined, full ' +
      'stop (see audit.mjs\'s hard-floor loop). RULING R18 (this row\'s fix round 1, 2026-09-10): an advisory ' +
      'reachable from the PRODUCTION dependency tree is NOT an automatic failure — it must instead carry a ' +
      '`productionRisk` object on its entry with three independently non-stub fields (`vulnerability`, ' +
      '`reachability`, `fix`), checked structurally; a production-tree advisory with a missing or vague ' +
      '`productionRisk` fails exactly as hard as one never recorded at all. The comparison is bidirectional ' +
      'like every ratchet in this layer: a new advisory not yet listed fails it, and a listed entry npm audit ' +
      'no longer reports fails it too. AS A DATED SNAPSHOT, RE-MEASURED 2026-09-15: npm audit reports 6 ' +
      'vulnerable package names, all severity high (0 critical), ALL RECORDED and this command is GREEN. ' +
      'IT REPORTED 8 ON 2026-09-10, AND THE TWO THAT LEFT ARE WORTH READING RATHER THAN CELEBRATING: ' +
      '@nestjs/schedule and nestjs-pino were deleted from the baseline on 2026-09-15 by this ratchet\'s own ' +
      'stale-entry rule, and NOTHING IN THIS REPOSITORY CHANGED to earn that — both sit at the identical ' +
      'versions the pre-merge lockfile pinned (12.0.1 and 5.1.0, verified against `git show ' +
      '<merge-base>:package-lock.json`), both still peer-depend on @nestjs/core, and multer@2.2.0 is still ' +
      'pinned exactly where it was. What moved is npm audit\'s own cascade over an advisory database this ' +
      'repo does not control: a narrower REPORT, not a smaller risk. Every ' +
      "one of the 6 traces to the same root cause — multer@2.2.0's DoS/bypass advisories GHSA-wc9g-mqfw-jrwm, " +
      'GHSA-qfvm-cv95-jqjf, GHSA-535w-7cp7-47q4 and GHSA-qvfw-j98x-7q72 — pulled in through ' +
      "@nestjs/platform-express@11.2.3's EXACT pin on multer 2.2.0 (confirmed: `npm view " +
      '@nestjs/platform-express@11.2.3 dependencies.multer` prints "2.2.0", no range). 5 of the 6 names — ' +
      'multer itself, @nestjs/core, @nestjs/platform-express, @nestjs/terminus and ' +
      '@nestjs/typeorm — sit in the production dependency tree (confirmed individually via ' +
      '`npm ls <name> --omit=dev`) and reach this app for real, through image uploads (backend/src/media, up ' +
      'to 10 MB) via multer\'s FileInterceptor — each carries a complete `productionRisk` recording that fact, ' +
      'not fixing it: a root `overrides.multer` entry was tried (`npm install`, then `npm install ' +
      '--package-lock-only`) and does NOT override @nestjs/platform-express\'s exact pin, so a real fix needs ' +
      'a repository-owner decision (the nested per-parent override form, a NestJS v12 upgrade, or a formally ' +
      'accepted risk) this verification task does not make on its own. Only @nestjs/testing is dev-only ' +
      '(confirmed empty via the same `npm ls` command) and needs only the plain `reason` field.',
    blindSpot:
      "Says nothing about a vulnerability with no advisory published yet. And a GREEN row here — including " +
      'today\'s — can mean either "genuinely no reachable risk" or "a known, reachable, high-severity risk ' +
      'that is RECORDED but not fixed": this check verifies that a `productionRisk` object\'s three fields ' +
      'EXIST and are non-stub, never that their CONTENT is true or that the described fix has actually been ' +
      'applied — a fabricated but plausible-sounding productionRisk entry passes exactly as well as an ' +
      "accurate one, and nothing here re-derives whether the reachability or fix claims still hold as the " +
      'tree changes. Reading this row\'s green as "no known production risk" is exactly the misreading R18 ' +
      'exists to prevent — the risk is in scripts/verify/baselines/audit.json, in detail, for a human to act ' +
      "on. Package-name granularity, not GHSA-id granularity: npm audit's own dependency-graph cascade marks " +
      "every package that merely DEPENDS on a vulnerable one as 'vulnerable' too, with no advisory object of " +
      'its own (`via` holds plain package-name strings there, not a titled entry) — so a single upstream ' +
      "advisory (multer's, here) inflates into as many baseline-relevant, individually-recorded names as " +
      "there are packages between it and the tree's roots, even though fixing multer alone would clear all 5 " +
      "simultaneously. `npm audit`'s own severity classification is trusted as-is: a severity GitHub later " +
      "reclassifies changes this row's verdict without anything in this repo changing, which is exactly why " +
      "this row needs `['npm-registry']` and lives in the full tier, never the fast one — and on 2026-09-15 " +
      'that stopped being a hypothetical: two names left this report with the lockfile untouched, which is ' +
      'the same mechanism running in the harmless direction. And `info`-severity ' +
      'findings are silently dropped before any comparison runs at all, matching npm audit\'s own metadata ' +
      'semantics but meaning a finding at that severity is invisible to this row twice over.',
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
      "`npm run build` (turbo's `build` task, `dependsOn: ['^build']`) exits 0 only when BOTH workspaces' own " +
      "build command exits 0: backend's `nest build` (a tsc compile of backend/src to backend/dist) and " +
      "frontend's `tsc -b && vite build` (a project-reference build across tsconfig.app.json and " +
      "tsconfig.node.json, THEN Vite's production bundle to frontend/dist) — a compile error or a bundler " +
      'failure in EITHER workspace fails this exact command. AS A DATED SNAPSHOT, RE-MEASURED 2026-09-15 on ' +
      "the tree this branch merged 156 commits of main into: both builds together complete in 4.8s wall " +
      "clock (turbo's own reported time, cache bypassed), and frontend's bundle still " +
      "carries Vite's generic \"(!) Some chunks are larger than 500 kB after minification\" warning on its " +
      'single JS chunk, now ~911 kB raw (267 kB gzip) against ~892 kB (266 kB gzip) on 2026-09-10 — a ' +
      'warning line, never a failure, and this row does not fail on it at any size.',
    blindSpot:
      'Proves the bundler and compiler succeed, not that the output is correct or that the app runs. Neither ' +
      'dist directory is executed, started, or even opened by this row: a backend that builds cleanly but ' +
      "throws on boot (bad DI wiring only Nest's own bootstrap would catch, not tsc), or a frontend bundle " +
      'that builds but renders a blank page, is exactly as green here as a correct one. The `smoke` row is ' +
      'what actually launches either — it exists now, in this same tier, and this sentence said "a future ' +
      'row, not yet part of this layer" until 2026-09-15, which had been wrong since Task 17 shipped it. ' +
      "`tsc -b`'s project-reference build can " +
      'also be satisfied by a STALE `.tsbuildinfo` incremental cache reporting "up to date" without ' +
      "re-checking every file — a risk `typecheck`'s own `tsc -b` invocation shares — so a rebuild from a warm " +
      "cache proves less than a clean one; this row does not force a clean build first. And it says nothing " +
      "about the bundle's SIZE being reasonable beyond Vite's own generic 500 kB chunk warning, which does not " +
      'fail the command at any size.',
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
      "Running the full test suite in BOTH workspaces with coverage instrumentation enabled exits 0 exactly " +
      "when `test` does — backend's jest (`NODE_OPTIONS=--experimental-vm-modules jest --coverage`, the " +
      "identical *.spec.ts-only testRegex `test` uses) and frontend's vitest (`vitest run --coverage`) — " +
      'instrumentation itself failing to load, or a test failing under instrumentation that passed without it, ' +
      'fails this exact command. IN ANY RUN CONTAINING BOTH, `test` THEREFORE DOES NOT RUN AT ALL (this row ' +
      "declares `supersedes: ['test']`, 2026-09-15): in the full tier — `verify:full`, `verify:ci`, and CI's " +
      'own `verify` job — every assertion in both workspaces is executed HERE, once, instrumented, and the one ' +
      'thing no longer proved anywhere in those runs is that the suites also pass UNINSTRUMENTED. The fast tier ' +
      'and the pre-push gate (`--exclude coverage`) do not contain this row, so `test` runs itself there exactly ' +
      'as it always has. NO FLOOR IS ENFORCED HERE, in this file, or anywhere else in this repo today ' +
      "— floors live only in .github/workflows/ci.yml's env: block, written by a later task in this plan, and " +
      "read as 0 locally — so a coverage PERCENTAGE dropping between two runs changes NOTHING about this row's " +
      'PASS/FAIL. AS A DATED SNAPSHOT, RE-MEASURED 2026-09-15 on the tree this branch merged 156 commits of ' +
      'main into (`npx turbo coverage --force`, never a cached replay): backend 79.51% statements / 61.19% ' +
      'branches / 78.24% functions / 82.97% lines (over files actually required by some *.spec.ts — jest\'s ' +
      'default ' +
      'collectCoverageFrom is unset here, so a file no spec ever imports, such as main.ts or app.module.ts, ' +
      'does not appear in the report AT ALL, not even at 0%); frontend 85.25% statements / 81.59% branches / ' +
      '79.37% functions / 85.66% lines under the identical default (main.tsx, App.tsx and router.tsx are ' +
      'likewise absent from its report today; router.tsx IS present, reached by ' +
      'app/router.test.tsx — this row claimed otherwise until 2026-09-15 and was wrong, ' +
      'including under a re-measured stamp). THE TWO WORKSPACES MOVED IN OPPOSITE DIRECTIONS and the ' +
      'backend half is the one to read: frontend rose on all four measures because main\'s cash and ' +
      'transfers screens arrived with their own component tests, while backend FELL on three. The ' +
      'mechanism is that this row measures the UNIT config only (testRegex .*\\.spec\\.ts$), so code ' +
      'reached solely by *.db-spec.ts suites cannot be credited here — but the three floors do NOT share a ' +
      'cause, and saying they did was this row\'s own error until 2026-09-15. Splitting the report by ' +
      'whether a file predates the merge: pre-merge files measure 79.34% statements / 80.35% functions, ' +
      'files NEW in the merge 80.65% / 64.79%. FUNCTIONS fell because of the merge (the new slices are at ' +
      '64.79%, point-cash at 28.57%); STATEMENTS and LINES fell DESPITE it — the new slices are ABOVE the ' +
      'aggregate on statements — and the whole gap is one pre-existing file growing, seed/dev-seed.ts ' +
      '(557 -> 699 lines, 19 of 239 statements covered, reached only by dev-seed.db-spec.ts). Excluding ' +
      'src/seed/ puts backend statements at 84.86% rather than 79.52%. The CI floors moved with the ' +
      'measurement in both directions: four frontend floors RAISED, three backend floors LOWERED, each a ' +
      'visible reviewed diff in ci.yml, which is the only place a floor may move. Both numbers move with ' +
      'ordinary feature work in either workspace and are not re-verified by this row.',
    blindSpot:
      'Measures lines executed, not assertions made — a test that calls a function and checks nothing about ' +
      'the result counts exactly as fully covered as one that verifies the answer; this row cannot tell the ' +
      "two apart, in either workspace. Because neither jest's nor vitest's config here sets an explicit " +
      'include list, a file never required/imported by any test is invisible to the report ENTIRELY rather ' +
      'than shown at 0% — confirmed empirically 2026-09-15 for main.ts/app.module.ts (backend) and ' +
      'main.tsx/App.tsx (frontend), absent from their respective reports. router.tsx was named in that ' +
      'list until 2026-09-15 and did not belong there: app/router.test.tsx imports it, so it has always ' +
      'been in the report. The claim was false when first written and survived a deliberate re-measurement ' +
      'pass, which is the honest illustration of this row\'s last sentence — so this row ' +
      'cannot even be used to spot untested files by scanning for a 0% line: a genuinely untested file and a ' +
      'file the report simply never mentions look identical from outside it. Branch coverage sits well below ' +
      'line coverage in both workspaces (61.19% vs 82.97% backend; 81.59% vs 85.66% frontend), meaning a real ' +
      'share of conditional paths run zero times under either suite despite the line they sit on reading as ' +
      'covered. And because no floor exists anywhere this row reads, nothing here stops either percentage ' +
      "from falling in a future change — that gate is ci.yml's alone, never this row's, and it is only as " +
      'strong as someone re-measuring: a floor is FLOORED DOWN to a whole percent, so between 0 and 1 ' +
      'percentage point of real regression passes CI silently by construction.',
  },
  {
    id: 'bundle',
    tier: 'full',
    cmd: 'npm run bundle',
    after: ['build'],
    // THIS IS THE FIRST REAL `after` IN THIS REGISTRY — every earlier row's own `after`
    // comment argues why ordering was NOT needed; this one argues the opposite. bundle-
    // size.mjs reads frontend/dist/assets directly off disk; unlike `coverage` (re-runs the
    // whole suite itself) or `audit` (shells out to npm's own tooling), it builds nothing.
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
      '`npm run bundle` (scripts/verify/checks/bundle-size.mjs) fails this exact command whenever the gzip OR ' +
      'the raw SUM of every `.js`/`.css` file directly under frontend/dist/assets exceeds the ceiling recorded ' +
      'in scripts/verify/baselines/bundle-budget.json — the two directions are independent (a raw-only overage ' +
      'fails exactly as hard as a gzip-only one), and the ceiling only ever changes through a separate, ' +
      'deliberate `--write` run plus a reviewed, dated edit to that JSON file, never automatically and never as ' +
      'a side effect of this command passing or failing. The ceiling itself is `measurement + a MINIMUM ' +
      'headroom` (25 KiB gzip / 100 KiB raw), THEN rounded up to a cosmetic step (5 KiB gzip / 20 KiB raw) — ' +
      'never pinned to the measurement byte-for-byte, and never a bare round-up with no minimum either. Both ' +
      'corrections were learned the hard way, at two different scales: the reference this check was ported ' +
      'from (webspirio/yagoda-crm) first pinned the ceiling to the exact measured byte count and broke on the ' +
      'very next commit over an 18-byte gzip increase from one ordinary helper; this port\'s own first version ' +
      'then "fixed" that with a bare round-up-to-the-next-step and no minimum, and its very first real ' +
      'measurement landed at 3,719 B of gzip headroom — 1.3% of the bundle — because the measurement happened ' +
      'to fall just past a step boundary, the SAME failure at a larger scale. What this ceiling exists to catch ' +
      'is a REGRESSION — a new dependency pulled in whole, an accidental whole-package import — measured in ' +
      'tens or hundreds of KiB, comfortably outside the minimum headroom; what it now deliberately tolerates is ' +
      'roughly one ordinary phase of feature work, sized against the reference\'s own measured history of ' +
      '13-23 KiB gzip per phase. AS A DATED SNAPSHOT, RE-MEASURED 2026-09-16 on the tree this branch merged ' +
      'a further 43 commits of main into (the crates slice, the price sheet, the sticky point scope): ' +
      'frontend/dist/assets holds exactly two such files, summing to 1028.9 KiB raw / 293.9 KiB gzip ' +
      'against an UNCHANGED ceiling of 1060.0 KiB raw / 305.0 KiB gzip — a headroom of 31.1 KiB raw / ' +
      '11.1 KiB gzip, down from 63.6 / 18.9 on 2026-09-15 and 104.3 / 28.6 on 2026-09-10. THREE READINGS, ' +
      'ONE DIRECTION: the gzip headroom is now UNDER HALF the 25 KiB minimum this ceiling was built with, ' +
      'so at the 13-23 KiB-per-phase rate it was sized against, the NEXT phase of feature work makes this ' +
      'row RED. That red is a real decision — split the bundle, or re-base the ceiling with a reviewed, ' +
      'dated `--write` — and it is now one phase away rather than hypothetical. THE CEILING WAS DELIBERATELY NOT RAISED to restore the old margin. Main\'s ' +
      'four screens cost 9.7 KiB gzip, which is inside the 13-23 KiB-per-phase band this ceiling was sized ' +
      'for, so the row did exactly what it is for: it absorbed one phase without a red run and printed the ' +
      'shrinking headroom on every green one. That headroom is now BELOW the 25 KiB gzip minimum the ceiling ' +
      'was originally built with, which is the honest reading of this number rather than a reason to move ' +
      'the ceiling — the next phase of comparable size makes this row RED, and that red will be a real ' +
      'decision (split the bundle, or re-base the ceiling with a reviewed, dated `--write`), not a rubber ' +
      'stamp. That headroom, not the pass/fail, ' +
      'is what this row is actually for: it is printed as a line starting with the literal word `WARNING` on ' +
      'EVERY passing run, and the runner\'s own warningLines() (`/WARNING|\\(!\\)/`, scripts/verify/run.mjs) ' +
      "surfaces it even though the row is green, so a green `bundle` row can never be read as 'nothing here to " +
      "watch' — and a ceiling with single-digit-percent headroom, this row's own history shows, is not a " +
      'stricter budget, it is one that trains people to raise it on sight.',
    blindSpot:
      'Measures the SUM of frontend/dist/assets, never what a browser actually downloads on first paint — and ' +
      'the two can move in OPPOSITE directions: code splitting turns one large chunk into several smaller ones ' +
      'plus a little overhead at every new chunk boundary, so the sum this row checks can GROW at the exact ' +
      "moment a real user's first download SHRINKS. A green row here is therefore a claim about total shipped " +
      'bytes, not about load time, and the number worth reading every run is the headroom line above, never the ' +
      'pass/fail alone. FIX ROUND 2 NARROWS this gap without closing it: a second, equally unconditional WARNING ' +
      'line now names the single largest `.js` chunk and its gzip size on every run — a real, non-trivial ' +
      'number today (index-BRwyrRRy.js at 267.3 KiB gzip, 93.4% of the 286.1 KiB total, because this bundle has ' +
      'no code splitting at all, so that one chunk is close to the whole first-visit download) — but it is a ' +
      'SIGNAL, never a gate: no chunk-size ceiling exists in this repo, this row does not invent one, and the ' +
      'line says nothing about which chunks a GIVEN ROUTE actually pulls once splitting exists — only which ' +
      'single file is largest across the whole build, still blind to per-route composition. It also counts ' +
      'only `.js`/`.css` files sitting directly under dist/assets: the 16 font ' +
      'files Vite copies alongside them today, any other static asset, and anything shipped outside dist/assets ' +
      'entirely (an inline index.html script, a public/ passthrough file) are invisible to both totals ' +
      "regardless of size. Gzip is measured at level 9 with Node's own zlib, not brotli and not whatever " +
      'compression level a real production server actually negotiates with a given browser, so the number this ' +
      "row checks is never the exact number that crosses a real user's wire. And this row trusts that " +
      "frontend/dist reflects a genuine, complete, current build: `after: ['build']` is what buys that guarantee " +
      'inside `npm run verify:full`, but `npm run bundle` run directly and standalone — exactly as every other ' +
      "check's npm script can also be run — re-verifies none of it, and would measure a stale or hand-edited " +
      "dist tree exactly as confidently as a fresh one. TASK 17 FOUND, THEN CLOSED, A CONCRETE WAY THIS BIT: " +
      "an earlier version of `smoke`'s own `webServer` (playwright.config.ts) wrote frontend/dist DIRECTLY " +
      "(`npm run build -w frontend`, bypassing Turbo entirely) — invisible to Turborepo's output cache, so a " +
      "`npm run build` this row's own `after: ['build']` depends on could satisfy `frontend#build` FROM CACHE " +
      "without ever running `vite build` again, landing its cached files ALONGSIDE smoke's leftover ones " +
      "instead of replacing them. Measured directly at 534 KiB gzip against this row's own 305 KiB ceiling, " +
      "roughly double the genuine 276 KiB — and, worse than the false RED, `smoke`'s build baked " +
      "`VITE_API_URL=http://localhost:3000` into the exact bytes this row measures as the shipped artifact, " +
      "so a run that happened to land GREEN was silently measuring a bundle that could never actually ship. " +
      "FIX ROUND 3 CLOSED THIS AT THE SOURCE, not by further guarding this row: `smoke` now builds and serves " +
      "from its own `E2E_OUT_DIR` (`frontend/dist-e2e`, `vite build`/`vite preview`'s own `--outDir`, see " +
      "e2e/constants.ts) and never reads or writes a single byte of `frontend/dist`. AS THINGS STAND NOW: " +
      "this repo's ONLY writer of `frontend/dist` is the `build` row, through `turbo build` — `smoke` cannot " +
      "reach it, in either direction, regardless of run order. THE PRACTICAL CONSEQUENCE THAT REMAINS: this " +
      "row still measures whatever files are physically sitting under frontend/dist/assets at the moment it " +
      "runs, nothing more — a stale or doubled dist directory left by someone building BY HAND through a " +
      "DIFFERENT path than `turbo build` (a direct `npm run build -w frontend` run manually, or Docker's own " +
      "image build writing to a different tree entirely) would still produce a FALSE RED that has nothing to " +
      "do with a real bundle-size regression, for the identical underlying reason (Turbo's cache restore does " +
      "not clear the directory first). A RED result here is still not self-diagnosing: before trusting it, " +
      "`rm -rf frontend/dist && npm run build` and re-run this row on that fresh output — only a RED that " +
      "survives a clean rebuild is a real budget overage. And the 25 KiB / 100 KiB minimum " +
      "headroom is an ABSOLUTE floor, not a percentage of the bundle: it is calibrated to today's ~276 KiB " +
      "gzip bundle and the " +
      "reference's own historical per-phase growth, not derived from the bundle's own size, so it does not " +
      'automatically stay proportionate as the bundle grows much larger or a phase turns out unusually large — ' +
      'nothing here re-derives that minimum on its own; a future re-measurement is what would catch it drifting ' +
      'out of proportion, not this check running unchanged.',
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
      "`npm run test:db -w backend` (`NODE_OPTIONS=--experimental-vm-modules jest --config " +
      'jest.db.config.js`, rootDir src, testRegex `.*\\.db-spec\\.ts$`, maxWorkers 1) exits 0 ' +
      "only when every one of this repo's *.db-spec.ts suites passes against a REAL Postgres, " +
      'migrated the same way production is (`ds.runMigrations()`, never `synchronize`) — ' +
      'constraints, unique indexes, cascade rules, FOR UPDATE SKIP LOCKED row locking and ' +
      "UNIQUE NULLS NOT DISTINCT behaviour the mocked `test` row cannot reach at all. BEFORE " +
      'A SINGLE MIGRATION RUNS, `openTestDataSource()` (backend/src/testing/db-harness.ts) ' +
      'DROPs and (re)CREATEs the TEST_DB_NAME database (default app_test) on a maintenance ' +
      'connection to the postgres administrative database — so this row\'s PASS is never a ' +
      'claim about what a previous test:db invocation, or an earlier suite in the same one, ' +
      'happened to leave behind: a database still carrying old rows can never make an ' +
      'idempotency assertion (dev-seed.db-spec.ts\'s «is idempotent — a second run inserts ' +
      'nothing») pass for the wrong reason. A single failing assertion in any suite this glob ' +
      'matches fails this exact command, independent of file or test count. AS A DATED ' +
      'SNAPSHOT, FILE COUNTS RE-MEASURED 2026-09-18 on main after PR #111 (the #11 password ' +
      'vault) landed alongside the verify layer (29 files on 2026-09-15, 23 before it, 12 ' +
      'files / 174 tests on 2026-09-10): 30 files match *.db-spec.ts, ' +
      'of which TEN are parse-and-apply migration-schema suites ' +
      '(migrations/{bootstrap-owner-create,cash-counts-schema,catalog-schema,crates-schema,' +
      'intake-top-ups-schema,intakes-payouts-schema,schema,suppliers-prices-schema,' +
      'transfers-schema,user-password-vault}.db-spec.ts — read off `git ls-files`, and note ' +
      'that the list this row carried until 2026-09-18 named only EIGHT, having silently ' +
      'missed crates-schema since main merged it: the file COUNT was pinned by ' +
      'registry.test.mjs and stayed honest, this hand-written enumeration beside it was not, ' +
      'which is exactly the split that test exists to expose), ' +
      'THREE that boot the FULL AppModule via Nest\'s Test.createTestingModule and drive it ' +
      'over real HTTP with supertest (testing/{pipeline,catalog-pipeline,documents-pipeline}.' +
      'db-spec.ts), the harness\'s own testing/db-harness.db-spec.ts, and eleven slice ' +
      'suites — cash-counts, intake-top-ups-list, payout-ceiling-top-ups, payout-race, ' +
      'point-cash, shift-close, shift-close-race, intake-top-ups-balance, ' +
      'supplier-balance-list and transfers-list. The drop/create claim was re-confirmed the ' +
      'same way it was first made: this exact command run twice in a row against the same ' +
      'already-populated database reported 23 suites / 286 tests passing both times, because ' +
      'the second run never saw the first run\'s rows in the first place. THAT LAST FIGURE IS ' +
      'THE 2026-09-15 READING AND WAS DELIBERATELY NOT RESTATED FOR 2026-09-18: the ' +
      'file counts above are derived from `git ls-files`, but the suite and test TOTALS need ' +
      'this command actually run, and the 2026-09-18 pass re-measured only the fast tier ' +
      'plus build/bundle/audit — no Postgres was started, so this row did not execute. A ' +
      'test total carried forward under a fresh date would be exactly the router.tsx mistake ' +
      'registry.test.mjs was written to stop.',
    blindSpot:
      'Exercises the schema and the queries against a real Postgres, and says nothing about ' +
      'the HTTP layer above them EXCEPT for the three pipeline suites named above — every ' +
      'other suite talks to a bare DataSource, never a controller, a guard, or an interceptor. ' +
      'The `postgres`/`redis` preconditions only prove each is REACHABLE (a bare TCP connect — ' +
      'see PRECONDITIONS.postgres/.redis above), never that DB_USER/DB_PASSWORD are correct or ' +
      'that DB_USER holds CREATEDB: a reachable Postgres with the wrong password, or a user ' +
      'without permission to DROP/CREATE DATABASE, makes this row FAIL, not SKIP — no ' +
      'different from any other command whose precondition is satisfied but whose body still ' +
      'cannot succeed. The fresh-database fix trades one risk for a narrower one: ' +
      'resetTestDatabase targets exactly the TEST_DB_NAME this process resolved, and only ever ' +
      'drops that name (guarded by the same resolveTestDatabaseName checks that already refuse ' +
      'DB_NAME itself and any name not ending _test), but it is not safe to run two test:db ' +
      'invocations concurrently against the same database, or to run it while something else ' +
      '(a developer\'s own psql session, an editor\'s schema browser) is connected to app_test ' +
      '— WITH (FORCE) disconnects that session mid-drop rather than waiting for it. THAT ' +
      'HAZARD WAS DEMONSTRATED, NOT ARGUED, ON 2026-09-15: two invocations started four ' +
      'seconds apart both exited 1, reporting 110 and 200 failed tests out of 286 — each ' +
      'run dropping the database the other was mid-way through using. THIS ROW IS ALSO KNOWN ' +
      'TO HAVE GONE RED ONCE WITHOUT THAT EXPLANATION, and it is recorded rather than ' +
      'rounded off: on the same day, one single (non-concurrent) invocation reported 12 ' +
      'failed / 274 passed, and SEVEN further runs before and after it — including three ' +
      'back-to-back immediately afterwards — were all 286/286 green. Its failure output was ' +
      'not captured, so the cause is unknown; what can be said is that a 12-failure ' +
      'signature looks nothing like the 110/200 the concurrency hazard produces, and that ' +
      'this row therefore has an observed, unexplained flake rate on this machine that no ' +
      'part of this layer currently detects — a retry would hide it, and this registry has ' +
      'no retries anywhere for exactly that reason. And Redis ' +
      "state is untouched by any of this: the global ThrottlerGuard's counters persist across a " +
      "test:db run exactly as before, which is why db-harness.ts's relaxThrottleForTests() " +
      'still exists and still matters.',
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
      "`npm run test:e2e` (`playwright test`, `retries: 0` — a single flaky run is exactly as " +
      "red as a deterministic one) exits 0 only when ALL THREE of e2e/smoke.spec.ts's " +
      'assertions hold, in one real Chromium session, against the REAL stack e2e/global-' +
      "setup.ts brings up — `docker compose up -d --wait postgres redis backend`, gated on the " +
      "same `/health/ready` healthcheck docker-compose.yml already defines, then `npm run " +
      "db:seed` (idempotent) — and a real production frontend build that playwright.config.ts's " +
      "own `webServer` builds and serves ITSELF, every run, from its OWN output directory " +
      "(`npm run build -w frontend -- --outDir dist-e2e && npm run preview -w frontend -- " +
      "--port 4173 --strictPort --outDir dist-e2e` — `vite preview`, never the dev server, and " +
      "never `frontend/dist`, `build`'s own output — see e2e/constants.ts's `E2E_OUT_DIR`): " +
      "(1) the sign-in page renders, and submitting the seeded owner's real credentials " +
      "(`admin`/`admin`) through the UI form reaches the dashboard; (2) the dashboard's «Квитанцій " +
      "сьогодні» stat tile renders a positive integer sourced from that seed — not NaN, and not " +
      "the zero that would be indistinguishable from an empty state; (3) zero " +
      "`page.on('pageerror')` events and zero `page.on('requestfailed')` events fired anywhere " +
      "during the run. FIX ROUND 2 CORRECTED A REAL BUG IN THIS ROW'S OWN DESIGN, found by " +
      "review, not by this row's own tests: Playwright starts a `webServer` PLUGIN before " +
      "`config.globalSetup` ever runs (`createGlobalSetupTasks`, read directly out of the " +
      "installed `playwright` package) — an earlier version of this row built the frontend " +
      "inside `global-setup.ts` and pointed `webServer` at a bare `vite preview`, which only " +
      "ever passed by ACCIDENT OF ROW ORDER inside `npm run verify:full` (the `build` row, " +
      "earlier in the same array, happened to leave a servable `frontend/dist` behind). Run " +
      "fully standalone — a fresh checkout, a CI runner, or this row's own immediately-" +
      "preceding run — it died with `Timed out waiting 60000ms from config.webServer`, with " +
      "`global-setup.ts` never having executed a single line: no compose, no seed, no " +
      "credentials, nothing. Fixed by moving the build INTO `webServer.command` itself so it " +
      "cannot depend on anything having run first; PROVEN by deleting its build output " +
      "directory and running `npm run test:e2e` completely standalone TWICE IN A ROW with no " +
      "build in between, both green (re-proven again after fix round 3 below, against the " +
      "current output directory). FIX ROUND 3 THEN FOUND, AND CLOSED, A SEPARATE BUG ROUND " +
      "2's OWN FIX INTRODUCED: building directly into `frontend/dist` (needed for standalone " +
      "self-sufficiency) put this row's build in the SAME directory `build`'s own `turbo " +
      "build` writes. Reproduced deterministically: `rm -rf frontend/dist && npm run build` " +
      "(turbo, one chunk) → a direct `npm run build -w frontend` (also one chunk, a different " +
      "content hash) → `npm run build` again (`FULL TURBO` cache hit) → `frontend/dist/assets` " +
      "then held BOTH chunks, because Turbo's cache restore does not clear the directory " +
      "first. Worse than the false RED this caused in `bundle`: that direct build baked " +
      "`VITE_API_URL=http://localhost:3000` — this row's own environment, never a real " +
      "production value — into the exact bytes `bundle` measures as the shipped artifact, so " +
      "a run that happened to land GREEN was silently measuring a bundle that could never " +
      "actually ship. Fixed by giving this row its OWN output directory, `dist-e2e` " +
      "(`E2E_OUT_DIR` in e2e/constants.ts), via `vite build`/`vite preview`'s own `--outDir` " +
      "flag on both halves of `webServer.command` — this row now never reads or writes a " +
      "single byte of `frontend/dist`, in either direction, regardless of run order. Two " +
      "mechanisms outside the brief's own 3-step list make " +
      "`global-setup.ts`'s own stack real rather than superficially so, both found " +
      "empirically, both documented there: `APP_URL` is overridden to the preview server's own " +
      "origin for the one `docker compose up` call (the backend's CORS allowlist otherwise " +
      'never includes the deliberately-non-5173 preview port, so every request the browser ' +
      'makes would be rejected before reaching the app — this also RECREATES the shared ' +
      "`backend` container, a mutation of state outside this row's own process, non-destructive " +
      "since the next plain `docker compose up` recreates it back); and any seeded shift still " +
      "open from a previous day is closed in Postgres before `db:seed` runs (`dev-seed.ts` opens " +
      "a fresh shift per point for \"today\" but never closes yesterday's, so its own " +
      'idempotency holds only WITHIN one calendar day — the first `db:seed` on any later day ' +
      "collides with Postgres's own `UQ_shifts_open_per_point` constraint without this). " +
      "`global-teardown.ts` then returns only the services THIS run itself started to " +
      "`stop`ped — never `down`, never `down -v` — because docker-compose.yml's project name " +
      "(`web-starter`) is shared across every worktree of this repo and the main checkout, and " +
      "`-v` would destroy the real `pg_data`/`uploads_dev` volumes; a service global-setup.ts " +
      "found already running (another session's) is left running, exactly as found — and " +
      "neither `global-setup.ts` nor `global-teardown.ts` ever touches `frontend/dist` at " +
      "all, in any fix round: `build`/`bundle` own that path, this row owns `dist-e2e`, and " +
      "the two never cross. AS A DATED SNAPSHOT, RE-MEASURED 2026-09-15 on the tree this " +
      "branch merged 156 commits of main into, the same way it was first measured: two " +
      "consecutive standalone `npm run test:e2e` runs, `dist-e2e` deleted before the first " +
      "and not rebuilt in between (each run rebuilds it itself, inside `webServer.command`), " +
      "both green, in 11.6s and 10.0s wall clock against the ~20s recorded on 2026-09-10 — " +
      "the difference is the stack, not the row: both of those runs found postgres, redis " +
      "and backend ALREADY UP, so `docker compose up -d --wait` returned immediately and " +
      "global-teardown correctly left every service running, as its own output says. A run " +
      "that has to start the stack pays that cost on top, and this figure does not include " +
      "it. The seeded network showed 6 receipts " +
      'across its three open-shift points (Шипинки 3, Конищів 2, Гайове 1 — counted directly ' +
      'in Postgres, backend/CLAUDE.md\'s Dev ' +
      "seed section) the day this was measured — a number that moves with the seed data and is " +
      'not re-verified by this row beyond being positive.',
    blindSpot:
      'Exercises exactly ONE path through the app — sign in, land on the dashboard, read one ' +
      'stat tile — and says nothing about any other screen, role, or flow: reception, day, ' +
      "debts, suppliers, catalog, prices, users, points, the operator's own dashboard variant, " +
      'none of it is touched here. It runs entirely against `npm run db:seed`\'s fixed SEEDED ' +
      'dataset, never real-world data shapes, volumes, or edge cases — a receipts count that ' +
      "happens to be exactly what the seed always produces proves nothing about a network with " +
      "a hundred points or a supplier with a decimal balance. And a PASS here means the stack " +
      'COMPOSES — the frontend, the backend, Postgres, Redis and a real browser all agree on how ' +
      'to talk to each other, CORS included — never that any business rule, §-numbered or ' +
      "otherwise, is actually correct: the dashboard could sum receipts wrong by exactly the " +
      "amount that still clears \"greater than zero\", and this row would stay green. Beyond " +
      "those three required admissions: only Chromium is launched (`playwright-browser`'s own " +
      'precondition checks exactly that binary), never Firefox or WebKit, so a browser-specific ' +
      "regression in either is invisible to this row. `page.on('requestfailed')` fires only for " +
      'a NETWORK-layer failure (refused connection, aborted, DNS) — a backend that answers with ' +
      'a well-formed 500 completes the HTTP transaction and is invisible to assertion 3 entirely, ' +
      'even though the dashboard may then render visibly broken. `global-setup.ts`\'s `APP_URL` ' +
      "override RECREATES the `backend` container docker-compose.yml names for ordinary dev use " +
      "— shared across every worktree of this repo and the main checkout — so anyone with the " +
      "dev stack actively running elsewhere on this machine sees their `backend` container " +
      "restart the moment this row runs; non-destructive, but a real mutation of state this " +
      "row's own process does not own. `webServer.command` rebuilds `frontend/dist-e2e` on " +
      "every run (`npm run build -w frontend -- --outDir dist-e2e`, a direct workspace-script " +
      "call outside Turbo's own cache) — as of fix round 3 this is a directory ONLY this row " +
      "ever writes, gitignored, never `frontend/dist`, so unlike an earlier version of this " +
      "row it does not affect, and is not affected by, whatever `build`/`bundle` most " +
      'recently measured on disk in the same session.',
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
