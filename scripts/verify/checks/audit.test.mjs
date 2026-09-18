/**
 * Tests for the advisory check.
 *
 * NOT ONE OF THESE SPAWNS npm, reaches the network, or reads this repository's tree. The
 * suite this replaced did all three: it wrote the real scripts/verify/baselines/audit.json
 * and asserted against the live advisory database, so it went red when GitHub reclassified
 * a severity on a tree nobody had touched — a verification suite reporting someone else's
 * edit as this repository's defect. `evaluate()` takes npm's JSON as an argument precisely
 * so that cannot happen again.
 *
 * The payloads below are the real shape, trimmed: npm keys `vulnerabilities` by package
 * NAME, and each `via` mixes titled advisory objects with bare package-name strings. The
 * strings are the cascade — the thing that turned one multer advisory into eight baseline
 * entries — and collapsing them is what the first two tests are about.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { ACCEPTED, advisoriesIn, evaluate } from './audit.mjs'

const TODAY = '2026-09-18'

/** @typedef {{ id: string, name: string, severity: string, title?: string }} Fixture */

/**
 * npm's report shape for these advisories, plus `cascade` package names that merely depend
 * on them and carry no advisory of their own.
 *
 * @param {Fixture[]} advisories
 * @param {string[]} [cascade]
 */
function payload(advisories, cascade = []) {
  /** @type {Record<string, { name: string, severity: string, via: any[] }>} */
  const vulnerabilities = {}
  // npm groups by package NAME and puts every advisory for it in one `via` array — multer
  // carried four that way. A helper that overwrote by name would hide exactly that case.
  for (const a of advisories) {
    vulnerabilities[a.name] ??= { name: a.name, severity: a.severity, via: [] }
    vulnerabilities[a.name].via.push({
      name: a.name,
      title: a.title ?? 'a title',
      url: `https://github.com/advisories/${a.id}`,
      severity: a.severity,
    })
  }
  for (const name of cascade) {
    vulnerabilities[name] = { name, severity: 'high', via: advisories.map((a) => a.name) }
  }
  return { vulnerabilities }
}

const MULTER = { id: 'GHSA-wc9g-mqfw-jrwm', name: 'multer', severity: 'high', title: 'DoS' }
const OK = { until: '2099-01-01', why: 'x'.repeat(60) }

test('a cascade of package names collapses to the one advisory behind it', () => {
  const found = advisoriesIn(
    payload([MULTER], ['@nestjs/core', '@nestjs/platform-express', '@nestjs/testing']),
  )
  // DISCRIMINATOR: four package names went in. Keying by name is what produced eight
  // baseline entries for one vulnerability; keying by GHSA id is what this asserts.
  assert.equal(found.size, 1)
  assert.equal([...found.keys()][0], MULTER.id)
})

test('two distinct advisories on one package are two findings', () => {
  const both = payload([MULTER, { id: 'GHSA-aaaa-bbbb-cccc', name: 'multer', severity: 'low' }])
  assert.equal(advisoriesIn(both).size, 2)
})

test('an empty report is green and says so', () => {
  const { problems, advisories } = evaluate({}, {}, {}, TODAY)
  assert.deepEqual(problems, [])
  assert.equal(advisories.length, 0)
})

test('an unaccepted advisory is RED', () => {
  const { problems } = evaluate(payload([MULTER]), payload([MULTER]), {}, TODAY)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /UNACCEPTED: high GHSA-wc9g-mqfw-jrwm/)
})

test('an accepted advisory is green', () => {
  const { problems } = evaluate(payload([MULTER]), payload([MULTER]), { [MULTER.id]: OK }, TODAY)
  assert.deepEqual(problems, [])
})

test('production reachability comes from the --omit=dev report, not from a hand-written flag', () => {
  const all = payload([MULTER])
  const devOnly = evaluate(all, {}, { [MULTER.id]: OK }, TODAY)
  const inProd = evaluate(all, all, { [MULTER.id]: OK }, TODAY)
  assert.equal(devOnly.advisories[0].production, false)
  assert.equal(inProd.advisories[0].production, true)
})

test('a CRITICAL in the production tree is RED even when it is accepted', () => {
  const crit = { id: 'GHSA-crit-0000-0000', name: 'bad', severity: 'critical' }
  const p = payload([crit])
  const { problems } = evaluate(p, p, { [crit.id]: OK }, TODAY)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /CRITICAL in the production tree/)
})

test('a CRITICAL that is dev-only may be accepted', () => {
  const crit = { id: 'GHSA-crit-0000-0000', name: 'bad', severity: 'critical' }
  const { problems } = evaluate(payload([crit]), {}, { [crit.id]: OK }, TODAY)
  assert.deepEqual(problems, [])
})

test('an acceptance npm no longer reports is RED, so the list only shrinks', () => {
  const { problems } = evaluate({}, {}, { [MULTER.id]: OK }, TODAY)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /STALE: GHSA-wc9g-mqfw-jrwm/)
})

test('an acceptance past its until date is RED', () => {
  const p = payload([MULTER])
  const { problems } = evaluate(p, p, { [MULTER.id]: { ...OK, until: '2026-09-17' } }, TODAY)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /EXPIRED: GHSA-wc9g-mqfw-jrwm/)
})

test('an acceptance expiring today is still valid; tomorrow it is not', () => {
  const p = payload([MULTER])
  assert.deepEqual(evaluate(p, p, { [MULTER.id]: { ...OK, until: TODAY } }, TODAY).problems, [])
  assert.equal(evaluate(p, p, { [MULTER.id]: { ...OK, until: '2026-09-17' } }, TODAY).problems.length, 1)
})

test('a malformed until date is RED rather than silently never expiring', () => {
  const p = payload([MULTER])
  for (const until of ['', 'soon', '2026-9-1', '01-01-2099']) {
    const { problems } = evaluate(p, p, { [MULTER.id]: { ...OK, until } }, TODAY)
    assert.equal(problems.length, 1, `until=${JSON.stringify(until)} should be one problem`)
    assert.match(problems[0], /must be YYYY-MM-DD/)
  }
})

test('a reason too short to be one is RED', () => {
  const p = payload([MULTER])
  const { problems } = evaluate(p, p, { [MULTER.id]: { until: '2099-01-01', why: 'later' } }, TODAY)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /`why` is 5 characters/)
})

test('bare package-name via entries alone produce no advisory', () => {
  // npm emits these for every package downstream of a vulnerable one. On their own they
  // describe nothing, and treating them as findings is what the old baseline did.
  const json = { vulnerabilities: { '@nestjs/core': { name: '@nestjs/core', via: ['multer'] } } }
  assert.equal(advisoriesIn(json).size, 0)
})

test('the ACCEPTED list this check actually ships obeys its own rules', () => {
  // The list is empty today. This test is what makes the next entry cheap to review and
  // impossible to leave open-ended: it holds the SHIPPED constant, not a fixture.
  for (const [id, entry] of Object.entries(ACCEPTED)) {
    assert.match(id, /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/, `${id} is not a GHSA id`)
    assert.match(entry.until, /^\d{4}-\d{2}-\d{2}$/, `${id}: until must be YYYY-MM-DD`)
    assert.ok(entry.why.trim().length >= 60, `${id}: why is too short to be a reason`)
  }
})
