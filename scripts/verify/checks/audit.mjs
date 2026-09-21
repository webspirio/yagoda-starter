/**
 * Every published advisory npm knows about, against a short list of the ones this
 * repository has decided to live with.
 *
 * WHAT REPLACED WHAT. This was 406 lines of check, 423 of test and a 67-line JSON baseline
 * keyed by PACKAGE NAME. Package names were the wrong key: one real advisory in `multer`
 * produced eight baseline entries, six of which carried no advisory of their own and
 * existed only because npm lists every package that depends on a vulnerable one. Six of
 * those eight entries said, at length, that they were cascades of the seventh. Keying on
 * the GHSA id collapses that to one row per real vulnerability, which is the number a
 * person actually has to make a decision about.
 *
 * THE ACCEPTANCE LIST IS THE POINT, and it is deliberately in this file rather than a JSON
 * baseline. It is empty right now. An advisory that can be fixed should be fixed — the six
 * this repository used to carry were fixed by one line in the root package.json
 * (`overrides.multer`), after a baseline had spent three weeks explaining why they could
 * not be. An entry here is for the case where that is genuinely not available, and it costs
 * a reviewer one diff hunk rather than a file nobody opens.
 *
 * FOUR WAYS THIS GOES RED, and every one of them is self-cancelling — none can be answered
 * by widening anything:
 *   1. an advisory nobody has accepted;
 *   2. a CRITICAL reachable from the production tree, which is never acceptable, entry or
 *      no entry;
 *   3. an accepted id npm no longer reports, which means delete the entry, not keep it;
 *   4. an accepted entry past its `until` date, which is the whole reason the date is
 *      mandatory: an acceptance that never expires is a deletion with extra steps.
 *
 * `evaluate()` is pure and takes npm's JSON as an argument, so the tests never spawn npm,
 * never touch the network and never read this repository's tree. That is not tidiness: the
 * old suite wrote the real baseline file and asserted against the real advisory database,
 * so it went red whenever GitHub reclassified something, on a tree nobody had touched.
 */
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { scanRoot } from '../scan-root.mjs'

/** This file's own path, quoted in every message that asks someone to edit it. */
const SELF = 'scripts/verify/checks/audit.mjs'

/**
 * Advisories this repository has read and decided to live with.
 *
 * Key: the GHSA id, exactly as it appears in the advisory URL npm prints.
 * `until`: YYYY-MM-DD, the date this decision stops being valid and must be re-made.
 * `why`: what was weighed — reachability first, then why the fix is not available.
 *
 * @type {Record<string, { until: string, why: string }>}
 */
export const ACCEPTED = {}

/** Under this, a `why` is not a reason. */
const MIN_WHY = 60

/** @typedef {{ id: string, name: string, severity: string, title: string, production: boolean }} Advisory */

/**
 * Every distinct GHSA advisory in one `npm audit --json` payload.
 *
 * npm reports a package once per vulnerable NAME, and each entry's `via` mixes titled
 * advisory objects with bare package-name strings — the strings are the cascade, carrying
 * no advisory of their own. Only the objects are real findings, and the same object appears
 * under every package downstream of it, so this keys by id and keeps the first.
 *
 * @param {any} json
 * @returns {Map<string, Advisory>}
 */
export function advisoriesIn(json) {
  /** @type {Map<string, Advisory>} */
  const found = new Map()
  for (const entry of Object.values(json?.vulnerabilities ?? {})) {
    for (const via of /** @type {any[]} */ (entry?.via ?? [])) {
      if (typeof via !== 'object' || !via?.url) continue
      const id = String(via.url).split('/').pop() ?? ''
      if (!id.startsWith('GHSA-')) continue
      if (!found.has(id)) {
        found.set(id, {
          id,
          name: String(via.name ?? entry.name ?? '?'),
          severity: String(via.severity ?? 'unknown'),
          title: String(via.title ?? '(untitled)'),
          production: false,
        })
      }
    }
  }
  return found
}

/**
 * The verdict, as a list of problems. Empty means green.
 *
 * @param {any} all npm audit --json over the whole tree
 * @param {any} prod npm audit --json --omit=dev
 * @param {Record<string, { until: string, why: string }>} accepted
 * @param {string} today YYYY-MM-DD
 * @returns {{ problems: string[], advisories: Advisory[] }}
 */
export function evaluate(all, prod, accepted, today) {
  const advisories = advisoriesIn(all)
  const inProduction = new Set(advisoriesIn(prod).keys())
  for (const a of advisories.values()) a.production = inProduction.has(a.id)

  const problems = []
  for (const a of [...advisories.values()].sort((x, y) => x.id.localeCompare(y.id))) {
    const where = a.production ? 'production tree' : 'dev only'
    const entry = accepted[a.id]
    if (a.severity === 'critical' && a.production) {
      problems.push(
        `CRITICAL in the production tree: ${a.id} (${a.name}) — "${a.title}". Never acceptable, with or without an entry: fix it or drop the dependency.`,
      )
      continue
    }
    if (!entry) {
      problems.push(
        `UNACCEPTED: ${a.severity} ${a.id} (${a.name}, ${where}) — "${a.title}". Fix it, or add it to ACCEPTED in ${SELF} with an \`until\` date and a reason.`,
      )
      continue
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.until)) {
      problems.push(`${a.id}: \`until\` must be YYYY-MM-DD, got "${entry.until}".`)
    } else if (entry.until < today) {
      problems.push(
        `EXPIRED: ${a.id} (${a.name}) was accepted until ${entry.until}. Re-decide it and move the date, or fix it — an acceptance nobody revisits is not one.`,
      )
    }
    if ((entry.why ?? '').trim().length < MIN_WHY) {
      problems.push(`${a.id}: \`why\` is ${(entry.why ?? '').trim().length} characters; at least ${MIN_WHY} are needed to say anything.`)
    }
  }

  for (const id of Object.keys(accepted).sort()) {
    if (!advisories.has(id)) {
      problems.push(
        `STALE: ${id} is accepted in ${SELF} but npm no longer reports it. Delete the entry — this list only shrinks.`,
      )
    }
  }

  return { problems, advisories: [...advisories.values()] }
}

/**
 * @param {string} root
 * @param {string[]} extra
 * @returns {any}
 */
function npmAudit(root, extra) {
  const r = spawnSync('npm', ['audit', '--json', ...extra], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  // npm audit exits 1 when it finds anything, so the code says nothing about success.
  // Unparseable stdout is the real failure, and it is what a registry outage looks like.
  try {
    return JSON.parse(r.stdout)
  } catch {
    process.stderr.write(`audit: npm audit produced no JSON.\n${r.stderr || r.stdout}\n`)
    process.exit(1)
  }
}

function main() {
  const root = scanRoot()
  const today = new Date().toISOString().slice(0, 10)
  const { problems, advisories } = evaluate(
    npmAudit(root, []),
    npmAudit(root, ['--omit=dev']),
    ACCEPTED,
    today,
  )

  if (problems.length > 0) {
    process.stdout.write('audit: RED\n')
    for (const p of problems) process.stdout.write(`  ${p}\n`)
    process.exit(1)
  }

  const prod = advisories.filter((a) => a.production).length
  process.stdout.write(
    `audit: ${advisories.length} advisories (${prod} reachable from the production tree), ` +
      `${Object.keys(ACCEPTED).length} accepted in ${SELF}, none unaccounted for and none stale\n`,
  )
  process.stdout.write(
    'audit: NOTE — this verdict depends on the npm registry advisory database, which ' +
      'changes with nothing in this repository. That is why the row needs npm-registry, ' +
      'lives in the full tier, and is outside the push gate.\n',
  )
}

if (process.argv[1]?.endsWith('audit.mjs')) main()
