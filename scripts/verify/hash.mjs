/**
 * Content-addressed identity of everything that can change what a check concludes.
 *
 * Never mtime, and never "is the working tree dirty" — a turn that commits its work
 * leaves a clean tree and would earn a free green.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Directory prefixes whose contents feed at least one check.
 *
 * THE SURFACE IS EVERY FILE GIT TRACKS OR WOULD TRACK, and there is no list of directories
 * here any more. There was: eight prefixes, twelve exact filenames and three regexes, each
 * admitted because "some check reads this". The rule is right; maintaining the list by hand
 * is what failed, four times. `.env.example` and `knip.json` were both missing and both
 * were reproduced end to end as replayed greens over red checks; `e2e/` and `.githooks/`
 * were found the same way.
 *
 * The fourth is why the list is gone rather than extended. `secrets` rule 3 scans EVERY
 * TRACKED FILE — `git ls-files -z`, no pathspec — looking for a credential pasted into
 * prose. The surface covered 920 of this repository's 977 tracked files, so a secret
 * written into docs/, README.md or any root markdown file left the digest unchanged, and
 * `--reuse-if-fresh` replayed a green without ever running the check that scans it.
 * Reproduced directly: writing an AWS-key-shaped line into docs/ and re-hashing returns the
 * identical digest.
 *
 * No list of paths could have been kept correct here, because the declared input of one
 * check is "all of them". So the surface is now git's own answer, and the maintenance
 * question — "is this new file an input?" — cannot be got wrong because it is not asked.
 *
 * The cost is stated rather than hidden: editing any tracked file, a document included,
 * stops a cached green from replaying. That is the correct behaviour when a check reads
 * documents, and the fast tier it re-runs is seconds.
 */

/**
 * A NUL byte cannot occur in a POSIX path, so it is the only safe field delimiter.
 * A newline or a colon would let a crafted filename forge a different file list that
 * hashes the same.
 */
const NUL = Buffer.from([0])


/**
 * The environment for a child `git`, with every GIT_* variable removed.
 *
 * `cwd` DOES NOT WIN OVER `GIT_DIR`. With that variable set, git ignores the working
 * directory entirely and operates on the repository it names — so `sourceHash(root)` would
 * silently hash a DIFFERENT repository than the one its own argument asks for. Git exports
 * GIT_DIR (and GIT_INDEX_FILE) into every hook it runs, and .githooks/pre-push runs this
 * layer, so the variable is present on exactly the path a local gate takes.
 *
 * Learned on 2026-09-15, expensively: the same inheritance let hash.test.mjs's fixture
 * commit into the real repository, replacing its tree with three fixture files. The hook
 * scrubs these as well; this is the lock that makes the function honour its own parameter
 * no matter who calls it.
 *
 * @returns {NodeJS.ProcessEnv}
 */
function gitEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
}

/**
 * @param {unknown} err
 * @returns {string}
 */
export function errMessage(err) {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Tracked files plus untracked-but-not-ignored files. `-o --exclude-standard` is what
 * pulls in a brand-new test or ratchet that has not been committed yet: without it a
 * freshly written failing test would not change the hash, and a stale green would be
 * served over it.
 *
 * Exported so the surface can be asked directly what it contains — hash.test.mjs uses it
 * to prove every path a check reads is in there.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function listHashedFiles(root) {
  let raw
  try {
    raw = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], {
      cwd: root,
      env: gitEnv(),
      maxBuffer: 128 * 1024 * 1024,
    })
  } catch (err) {
    throw new Error(`sourceHash: git could not enumerate files: ${errMessage(err)}`)
  }
  // `-c` and `-o` can both name the same path in some states; dedupe before hashing so
  // the digest depends on the set of files, not on git's listing order. `--exclude-standard`
  // is the only filter, and it is git's, not ours: node_modules, dist and every other
  // gitignored artifact is out, everything a person could commit is in.
  const seen = new Set(raw.toString('utf8').split('\u0000').filter(Boolean))
  return [...seen].sort()
}

/**
 * The commits `migrations` compares against, folded into the digest.
 *
 * NOT A FILE, AND THEREFORE INVISIBLE TO EVERY FILE-BASED SURFACE — which is the point.
 * `migrations` rule 4a compares this branch against origin/main and rule 4b against the
 * merge-base with it. A `git fetch` moves origin/main without touching one tracked byte, so
 * the comparison basis changes while the digest does not, and `--reuse-if-fresh` replays a
 * verdict that was reached against a different main. That is the same false green as an
 * unhashed input file, in the one shape no list of paths can cover.
 *
 * Unreachable refs record as ABSENT rather than throwing: a worktree with no origin is a
 * state `migrations` itself handles by SKIPPING the rule with a warning, and the digest
 * should describe that state, not refuse to be computed in it.
 *
 * @param {string} root
 * @returns {string}
 */
function refState(root) {
  const read = (/** @type {string[]} */ args) => {
    try {
      return execFileSync('git', args, { cwd: root, env: gitEnv(), encoding: 'utf8' }).trim()
    } catch {
      return 'ABSENT'
    }
  }
  const origin = read(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'])
  const base = origin === 'ABSENT' ? 'ABSENT' : read(['merge-base', 'HEAD', 'refs/remotes/origin/main'])
  return `origin/main=${origin};merge-base=${base}`
}

/**
 * @param {string} root
 * @returns {{ hash: string, fileCount: number }}
 */
export function sourceHash(root) {
  const files = listHashedFiles(root)
  const outer = createHash('sha256')
  for (const rel of files) {
    outer.update(rel, 'utf8')
    outer.update(NUL)
    let digest = 'ABSENT'
    try {
      digest = createHash('sha256').update(readFileSync(path.join(root, rel))).digest('hex')
    } catch {
      // Tracked but removed from the worktree. Recorded as ABSENT rather than skipped,
      // so a deletion is a visible field change and not an invisible shorter list.
    }
    outer.update(digest, 'utf8')
    outer.update(NUL)
  }
  outer.update(refState(root), 'utf8')
  outer.update(NUL)
  return { hash: outer.digest('hex'), fileCount: files.length }
}

// Diagnostic entry point: `node scripts/verify/hash.mjs` prints exactly which files
// feed the freshness decision. Without this the hash is an opaque number and "why was
// my green reused?" has no answer.
if (process.argv[1] && process.argv[1].endsWith('hash.mjs')) {
  // `node scripts/verify/hash.mjs | head -1` closes the pipe early; without this the
  // diagnostic dies with an unhandled EPIPE and a stack trace.
  process.stdout.on('error', () => process.exit(0))
  const root = process.cwd()
  const { hash, fileCount } = sourceHash(root)
  process.stdout.write(`sourceHash ${hash}\n${fileCount} files:\n`)
  for (const f of listHashedFiles(root)) process.stdout.write(`  ${f}\n`)
}
