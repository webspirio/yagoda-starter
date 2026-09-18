/**
 * The tree a check scans, and the environment its child `git` runs in.
 *
 * TWO DEFECTS, ONE MODULE, because they have to be fixed together.
 *
 * SCAN ROOT. Every check hard-coded `path.resolve(import.meta.dirname, '..', '..', '..')`,
 * so its own fixture tests had nowhere to put a fixture except the REAL working tree —
 * planting files under backend/src, rewriting .gitignore and both eslint configs, staging
 * paths into the real git index, and in two cases `rmSync`-ing a tracked source file. Every
 * restore lived in a `finally` that a killed process never runs, and the Stop hook ran all
 * of it after every turn. An override is what lets a fixture be a `mkdtempSync` directory.
 *
 * GIT ENVIRONMENT. `cwd` DOES NOT WIN OVER `GIT_DIR`. With that variable set, git ignores
 * the working directory entirely and operates on the repository it names — and git EXPORTS
 * it into every hook it runs. Only hash.mjs scrubbed it; nine other checks shelled out to
 * git with the environment inherited, so under a hook, a `git bisect run`, or a rebase
 * `exec`, they enumerate ANOTHER repository's index and scan a file set with nothing to do
 * with this tree. That is a false green, not a crash. The same inheritance once replaced
 * this repository's HEAD with three fixture files.
 *
 * A scan root without the scrub is worse than neither: the fixture passes for the wrong
 * reason, because git read the real index instead of the fixture's.
 */
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')

/**
 * Precedence: `--root <dir>` > `VERIFY_SCAN_ROOT` > the real repository root.
 *
 * @param {string[]} [argv]
 * @returns {string}
 */
export function scanRoot(argv = process.argv) {
  const i = argv.indexOf('--root')
  if (i !== -1 && argv[i + 1]) return path.resolve(argv[i + 1])
  if (process.env.VERIFY_SCAN_ROOT) return path.resolve(process.env.VERIFY_SCAN_ROOT)
  return REPO_ROOT
}

/**
 * The environment for a child `git`, with every GIT_* variable removed and the global and
 * system configs neutralised.
 *
 * The config part matters for fixtures specifically: `~/.gitconfig`'s `init.templateDir`
 * installs hooks into every `git init`, and `core.excludesFile` changes what
 * `--exclude-standard` hides — so without this a fixture's result depends on whose laptop
 * it runs on.
 *
 * @returns {NodeJS.ProcessEnv}
 */
export function gitEnv() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
  )
  env.GIT_CONFIG_GLOBAL = '/dev/null'
  env.GIT_CONFIG_SYSTEM = '/dev/null'
  return env
}

/**
 * Refuse to report a verdict about nothing.
 *
 * A check whose scan matched zero files printed its positive claim and exited 0 —
 * reproduced for both `seam` and `migrations` against an empty backend/src. That is the
 * exact false green this layer exists to refuse, and it is the failure mode a scan-root
 * argument makes MORE likely, not less: point a check at the wrong directory and it agrees
 * with you.
 *
 * @param {string} id
 * @param {number} count
 * @param {string} what
 * @param {string} root
 * @returns {void}
 */
export function refuseEmptyScan(id, count, what, root) {
  if (count > 0) return
  process.stderr.write(
    `${id}: scanned ZERO ${what} under ${root} — refusing to report a verdict. ` +
      'Either the enumeration broke or the root is wrong; a check that looked at nothing ' +
      'must not print that it found nothing wrong.\n',
  )
  process.exit(1)
}
