import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { sourceHash, errMessage, isHashed } from './hash.mjs'

/**
 * Every GIT_* variable stripped from the environment handed to a child `git`.
 *
 * NOT paranoia — this destroyed a real commit on 2026-09-15. `cwd` DOES NOT WIN over
 * `GIT_DIR`: with GIT_DIR set, git ignores the working directory entirely and operates on
 * the repository that variable names. Git EXPORTS GIT_DIR (and GIT_INDEX_FILE) to every
 * hook it runs, so the moment this suite ran from inside a pre-push hook — through
 * `selfcheck`, which is what a pre-push gate is for — this fixture's `git add -A` and
 * `git commit` stopped touching its own throwaway repo and wrote to the REAL one instead,
 * committing the three fixture files as the whole tree and deleting 894 real ones. The
 * working tree survived; HEAD did not.
 *
 * The hook scrubs these too (.githooks/pre-push), so this is the second of two locks. One
 * is not enough: a hook is not the only thing that can export GIT_DIR, and this fixture
 * must be safe wherever it runs.
 */
const NO_GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
)

/** A throwaway git repo shaped like this one, so `git ls-files` has something to list. */
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'verify-hash-'))
  execFileSync('git', ['init', '-q'], { cwd: root, env: NO_GIT_ENV })
  mkdirSync(path.join(root, 'backend', 'src'), { recursive: true })
  writeFileSync(path.join(root, 'backend', 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(path.join(root, 'package.json'), '{"name":"x"}\n')
  writeFileSync(path.join(root, '.gitignore'), 'ignored/\n')
  mkdirSync(path.join(root, 'ignored'), { recursive: true })
  writeFileSync(path.join(root, 'ignored', 'junk.ts'), 'export const junk = 1\n')
  execFileSync('git', ['add', '-A'], { cwd: root, env: NO_GIT_ENV })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], {
    cwd: root,
    env: NO_GIT_ENV,
  })
  return root
}

test('the same tree hashes the same twice', () => {
  const root = fixture()
  try {
    assert.equal(sourceHash(root).hash, sourceHash(root).hash)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('editing a hashed file changes the hash', () => {
  const root = fixture()
  try {
    const before = sourceHash(root).hash
    writeFileSync(path.join(root, 'backend', 'src', 'a.ts'), 'export const a = 2\n')
    assert.notEqual(sourceHash(root).hash, before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an UNCOMMITTED new file changes the hash — a stale green must not outlive a new test', () => {
  const root = fixture()
  try {
    const before = sourceHash(root).hash
    writeFileSync(path.join(root, 'backend', 'src', 'b.spec.ts'), 'it("x", () => {})\n')
    assert.notEqual(sourceHash(root).hash, before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a gitignored file does NOT change the hash', () => {
  const root = fixture()
  try {
    const before = sourceHash(root).hash
    writeFileSync(path.join(root, 'ignored', 'junk.ts'), 'export const junk = 2\n')
    assert.equal(sourceHash(root).hash, before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a file outside the hashed surface does NOT change the hash', () => {
  const root = fixture()
  try {
    const before = sourceHash(root).hash
    mkdirSync(path.join(root, 'docs'), { recursive: true })
    writeFileSync(path.join(root, 'docs', 'notes.md'), 'hello\n')
    assert.equal(sourceHash(root).hash, before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('deleting a tracked file changes the hash rather than shortening the list invisibly', () => {
  const root = fixture()
  try {
    const before = sourceHash(root)
    rmSync(path.join(root, 'backend', 'src', 'a.ts'))
    const after = sourceHash(root)
    assert.notEqual(after.hash, before.hash)
    assert.equal(after.fileCount, before.fileCount, 'the file is ABSENT, not absent from the list')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('errMessage survives a non-Error throw', () => {
  assert.equal(errMessage(new Error('boom')), 'boom')
  assert.equal(errMessage('boom'), 'boom')
})

test('sourceHash honours its root argument even when GIT_DIR points somewhere else', () => {
  // THE REGRESSION THIS PINS COST A REPOSITORY. `cwd` does not win over `GIT_DIR`: with
  // that variable set, git ignores the working directory and acts on the repository it
  // names. Git exports it into every hook, and .githooks/pre-push runs this layer through
  // `selfcheck` — so on 2026-09-15 this suite's own fixture committed into the REAL repo,
  // replacing its tree with three fixture files and dropping 894 real ones from the index.
  //
  // THE DISCRIMINATOR HAD TO BE BUILT DELIBERATELY, and the first attempt at this test was
  // worthless: it pointed GIT_DIR at a second fixture built by the same helper, so both
  // repositories tracked the SAME paths and the union was indistinguishable from the right
  // answer — it passed with the fix removed. Measured directly: under `cwd=B, GIT_DIR=A`,
  // `git ls-files -c -o` returns B's files (found in the working directory) PLUS A's
  // tracked paths (read from A's index). So the leak is only visible when A tracks a path
  // B does not have. That is what `zz-leak.ts` below is for.
  const a = fixture()
  const b = fixture()
  try {
    writeFileSync(path.join(a, 'backend', 'src', 'zz-leak.ts'), 'export const leak = 1\n')
    execFileSync('git', ['add', '-A'], { cwd: a, env: NO_GIT_ENV })
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'leak'], {
      cwd: a,
      env: NO_GIT_ENV,
    })

    const gitDirOfA = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
      cwd: a,
      env: NO_GIT_ENV,
      encoding: 'utf8',
    }).trim()

    const clean = sourceHash(b)

    const saved = process.env.GIT_DIR
    process.env.GIT_DIR = gitDirOfA
    try {
      const underForeignGitDir = sourceHash(b)
      assert.equal(
        underForeignGitDir.fileCount,
        clean.fileCount,
        "sourceHash(b) counted a different number of files with GIT_DIR pointing at another " +
          'repository — it read GIT_DIR instead of its own argument, and that repo\'s tracked ' +
          'paths leaked into the digest',
      )
      assert.equal(
        underForeignGitDir.hash,
        clean.hash,
        'sourceHash(b) returned a different digest purely because GIT_DIR was set',
      )
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR
      else process.env.GIT_DIR = saved
    }
  } finally {
    rmSync(a, { recursive: true, force: true })
    rmSync(b, { recursive: true, force: true })
  }
})

/**
 * THE DUAL OF 'a file outside the hashed surface does NOT change the hash'.
 *
 * That test alone is why .env.example and knip.json sat outside the surface for as long as
 * they did: it only ever asserted the OUTWARD direction. A surface can be arbitrarily
 * narrow and still pass it. What was never asserted is the direction that matters — that
 * every file a check actually reads IS inside, so editing one invalidates the cached
 * report instead of being replayed over.
 *
 * The declared-input list is NOT written here. It is extracted from the check sources, so
 * this test has no second copy to drift from: add `path.join(ROOT, 'newthing.json')` to a
 * check and this test fails until the surface covers it. That is invariant #5 — a check's
 * declared scope tied mechanically to its actual scope — applied to the surface itself.
 */
const CHECK_DIRS = ['checks', 'ratchets']

/**
 * Paths a check resolves against ROOT that are deliberately NOT hashed. Every entry is a
 * reason, and an entry that stops matching is a stale exception, so the test says so.
 *
 * @type {{ rel: string, why: string }[]}
 */
const NOT_CONTENT = [
  {
    rel: 'node_modules/.bin/knip',
    why: 'a tool binary, not scanned content — its version is proxied by package-lock.json, which IS hashed',
  },
  {
    rel: 'frontend/dist/assets',
    why: 'build output, gitignored — derived from frontend/src, which IS hashed, and ordered behind `build` by `after`',
  },
]

/**
 * Every repo-root-relative path literal a check module resolves against ROOT.
 *
 * Two shapes cover all of them, and the check modules are written in only these two:
 *   path.join(ROOT, 'a', 'b')         — a file or directory the check reads
 *   ['ls-files', …, '--', 'a/b']      — a git pathspec the check enumerates
 * A module-level `const NAME_REL = 'a/b'` indirection is resolved first, because several
 * checks name their baseline that way.
 *
 * @returns {{ rel: string, at: string }[]}
 */
function declaredInputs() {
  /** @type {{ rel: string, at: string }[]} */
  const out = []
  for (const dir of CHECK_DIRS) {
    const abs = path.join(import.meta.dirname, dir)
    for (const file of readdirSync(abs)) {
      if (!file.endsWith('.mjs') || file.endsWith('.test.mjs')) continue
      const src = readFileSync(path.join(abs, file), 'utf8')
      const where = `scripts/verify/${dir}/${file}`

      /** `const X = 'a/b'` — only plain single-quoted literals, which is all these files use. */
      const consts = new Map()
      for (const m of src.matchAll(/^const ([A-Z][A-Z0-9_]*) = '([^']+)'$/gm)) {
        consts.set(m[1], m[2])
      }

      for (const m of src.matchAll(/path\.join\(ROOT,\s*([^)]*)\)/g)) {
        const args = m[1].split(',').map((s) => s.trim()).filter(Boolean)
        if (!args.length) continue
        const parts = args.map((a) => {
          const lit = /^'([^']*)'$/.exec(a)
          if (lit) return lit[1]
          return consts.get(a) ?? null
        })
        if (parts.some((p) => p === null)) continue // a runtime value; nothing to assert
        out.push({ rel: parts.join('/'), at: where })
      }

      for (const m of src.matchAll(/'--',\s*'([^']+)'/g)) {
        if (m[1].startsWith('.env')) continue // a pathspec pattern, not a path
        out.push({ rel: m[1], at: where })
      }
    }
  }
  return out
}

test('EVERY path a check resolves against ROOT is inside the hash surface', () => {
  const seenExceptions = new Set()
  const missing = []
  for (const { rel, at } of declaredInputs()) {
    const exception = NOT_CONTENT.find((e) => e.rel === rel)
    if (exception) {
      seenExceptions.add(rel)
      continue
    }
    if (!isHashed(rel)) missing.push(`${at} reads ${rel}`)
  }
  assert.deepEqual(
    missing,
    [],
    'these paths feed a check and are OUTSIDE the freshness surface, so editing one leaves ' +
      'sourceHash unchanged and `--reuse-if-fresh` replays the stored verdict over it — a ' +
      'false green on the Stop gate\'s own path. Add them to hash.mjs, or add a reasoned ' +
      `entry to NOT_CONTENT here:\n  ${missing.join('\n  ')}`,
  )

  const stale = NOT_CONTENT.filter((e) => !seenExceptions.has(e.rel)).map((e) => e.rel)
  assert.deepEqual(
    stale,
    [],
    'these NOT_CONTENT exceptions no longer match anything a check reads. An exception that ' +
      'has outlived its finding is exactly what this layer refuses to carry — delete them.',
  )
})

test('editing any declared input actually moves the digest', () => {
  // isHashed() alone is a statement about a predicate. This runs the REAL sourceHash over a
  // real git tree and asserts the digest moves for every declared input, so the test cannot
  // pass because the predicate and the scan disagree.
  const root = mkdtempSync(path.join(tmpdir(), 'verify-inputs-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: root, env: NO_GIT_ENV })
    const rels = [...new Set(declaredInputs().map((d) => d.rel))]
      .filter((rel) => !NOT_CONTENT.some((e) => e.rel === rel))
      // A directory needs a witness file inside it; a file is written as itself. A
      // basename with no dot at all is the directory case — `.gitignore` and
      // `.env.example` are files despite path.extname() disagreeing about the first.
      .map((rel) => (path.basename(rel).includes('.') ? rel : `${rel}/zz-witness.ts`))
    assert.ok(rels.length > 0, 'extracted no declared inputs at all — the extractor stopped matching')

    for (const rel of rels) {
      mkdirSync(path.join(root, path.dirname(rel)), { recursive: true })
      writeFileSync(path.join(root, rel), 'seed\n')
    }
    execFileSync('git', ['add', '-A'], { cwd: root, env: NO_GIT_ENV })
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], {
      cwd: root,
      env: NO_GIT_ENV,
    })

    for (const rel of rels) {
      const before = sourceHash(root).hash
      appendFileSync(path.join(root, rel), 'touched\n')
      assert.notEqual(
        sourceHash(root).hash,
        before,
        `editing ${rel} did not change sourceHash, but a check reads it — ` +
          '`--reuse-if-fresh` would replay a green over that change',
      )
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
