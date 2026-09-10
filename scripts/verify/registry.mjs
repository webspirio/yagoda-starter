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
