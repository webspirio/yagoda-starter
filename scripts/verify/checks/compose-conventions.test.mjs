/**
 * Every fixture is a `mkdtempSync` directory holding one synthetic docker-compose.prod.yml;
 * the check takes `--root <dir>`, so nothing here reads or touches the real working tree
 * except the one test that asserts the real file passes.
 *
 * The two rules under test are the two compose conventions that were each discovered in
 * production first (docs/coolify-deploy.md): a sibling service addressed by its literal
 * name dies in every preview, and `KEY: ${KEY:-default}` is rewritten by Coolify's parser
 * into the production env set's literal.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(REPO, 'scripts', 'verify', 'checks', 'compose-conventions.mjs')

/**
 * @param {string} [root]
 * @returns {{ status: number, out: string }}
 */
function run(root) {
  const args = root ? [CHECK, '--root', root] : [CHECK]
  try {
    return { status: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (err) {
    const e = /** @type {{ status?: number, stdout?: string, stderr?: string }} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/**
 * @template T
 * @param {string} compose the fixture's docker-compose.prod.yml
 * @param {(dir: string) => T} fn
 * @returns {T}
 */
function withFixture(compose, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compose-conventions-'))
  try {
    writeFileSync(path.join(dir, 'docker-compose.prod.yml'), compose)
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** A compose that follows both conventions, exercising every shape that must stay green. */
const CLEAN = `name: fixture
volumes:
  pg_data:
services:
  postgres:
    image: postgres:16-alpine
    environment:
      # key and variable differ — the parser leaves this alone
      POSTGRES_USER: \${DB_USER:-app}
    mem_limit: \${POSTGRES_MEM_LIMIT:-256m}
  redis:
    image: redis:7-alpine
  backend:
    image: example/backend:\${IMAGE_TAG:-sha-\${SOURCE_COMMIT}}
    environment:
      DB_HOST: \${SERVICE_NAME_POSTGRES:-postgres}
      REDIS_HOST: "\${SERVICE_NAME_REDIS:-redis}"
      DB_USER: \${DB_USER:-app}
      NODE_OPTIONS: --max-old-space-size=\${BACKEND_HEAP_MB:-256}
      APP_URL: \${APP_URL}
      BOOTSTRAP_OWNER_PASSWORD: \${BOOTSTRAP_OWNER_PASSWORD}
      TRUST_PROXY_HOPS: 2
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy
`

test('a compose that follows both conventions is green and the verdict names what was scanned', () => {
  withFixture(CLEAN, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 0, res.out)
    assert.match(res.out, /^compose: conventions hold/)
    assert.match(res.out, /\b9 environment entries across 3 services\b/)
    assert.match(res.out, /allowlisted: backend\.DB_USER\b/)
  })
})

test('`KEY: ${KEY:-default}` for a per-environment key is RED and the finding names the key and its line', () => {
  const compose = CLEAN.replace('      NODE_ENV: production\n', '      NODE_ENV: production\n      SEED_DEV_DATA: ${SEED_DEV_DATA:-}\n')
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /compose: RED/)
    assert.match(res.out, /backend\.SEED_DEV_DATA \(line \d+\)/)
    assert.match(res.out, /\$\{SEED_DEV_DATA\}/)
  })
})

test('the other same-name default operators (`-`, `:?`, `?`) are RED too — the parser treats them alike', () => {
  for (const op of ['-', ':?', '?']) {
    const compose = CLEAN.replace('      NODE_ENV: production\n', `      NODE_ENV: production\n      PASSWORD_VAULT_KEY: \${PASSWORD_VAULT_KEY${op}x}\n`)
    withFixture(compose, (dir) => {
      const res = run(dir)
      assert.equal(res.status, 1, `operator ${op}:\n${res.out}`)
      assert.match(res.out, /backend\.PASSWORD_VAULT_KEY/)
    })
  }
})

test('an allowlisted same-name default stays green and is reported as allowlisted', () => {
  const compose = CLEAN.replace('      NODE_ENV: production\n', '      NODE_ENV: production\n      APP_TIMEZONE: ${APP_TIMEZONE:-Europe/Kyiv}\n')
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 0, res.out)
    assert.match(res.out, /allowlisted: backend\.APP_TIMEZONE, backend\.DB_USER\b/)
  })
})

test('an allowlist entry is scoped to one service — the same key elsewhere is still RED', () => {
  const compose = CLEAN.replace(
    '  redis:\n    image: redis:7-alpine\n',
    '  redis:\n    image: redis:7-alpine\n    environment:\n      DB_USER: ${DB_USER:-app}\n',
  )
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /redis\.DB_USER \(line \d+\)/)
  })
})

test('environment: in flow form is refused with the line, never skipped', () => {
  for (const flow of ['{ DB_HOST: postgres }', '[DB_HOST=postgres]']) {
    const compose = CLEAN.replace(
      '    environment:\n      DB_HOST: ${SERVICE_NAME_POSTGRES:-postgres}\n      REDIS_HOST: "${SERVICE_NAME_REDIS:-redis}"\n      DB_USER: ${DB_USER:-app}\n      NODE_OPTIONS: --max-old-space-size=${BACKEND_HEAP_MB:-256}\n      APP_URL: ${APP_URL}\n      BOOTSTRAP_OWNER_PASSWORD: ${BOOTSTRAP_OWNER_PASSWORD}\n      TRUST_PROXY_HOPS: 2\n      NODE_ENV: production\n',
      `    environment: ${flow}\n`,
    )
    withFixture(compose, (dir) => {
      const res = run(dir)
      assert.equal(res.status, 1, `${flow}:\n${res.out}`)
      assert.match(res.out, /line \d+/)
      assert.match(res.out, /flow form/)
    })
  }
})

test('an environment: inside a top-level extension field is not a service block and is not misreported', () => {
  const compose = `x-shared: &shared\n  environment:\n    LOG_LEVEL: info\n${CLEAN}`
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 0, res.out)
  })
})

test('a merge key inside a service is refused — the check does not follow anchors', () => {
  const compose = `x-shared: &shared\n  environment:\n    DB_HOST: postgres\n${CLEAN}`.replace(
    '  redis:\n    image: redis:7-alpine\n',
    '  redis:\n    <<: *shared\n    image: redis:7-alpine\n',
  )
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /merge key/)
    assert.match(res.out, /line \d+/)
  })
})

test('a bare sibling-service hostname is RED and the finding spells out the SERVICE_NAME_ form', () => {
  const compose = CLEAN.replace('      DB_HOST: ${SERVICE_NAME_POSTGRES:-postgres}\n', "      DB_HOST: 'postgres'\n")
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /backend\.DB_HOST \(line \d+\)/)
    assert.match(res.out, /\$\{SERVICE_NAME_POSTGRES:-postgres\}/)
  })
})

test('a value that merely equals a word which is not a service in this file is not a finding', () => {
  const compose = CLEAN.replace('      NODE_ENV: production\n', '      NODE_ENV: production\n      LOG_TARGET: nginx\n')
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 0, res.out)
  })
})

test('a list-form environment block is scanned the same way', () => {
  const compose = CLEAN.replace(
    '    environment:\n      DB_HOST: ${SERVICE_NAME_POSTGRES:-postgres}\n',
    '    environment:\n      - DB_HOST=postgres\n',
  )
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /backend\.DB_HOST/)
  })
})

test('a sibling-service hostname inside a URL value is RED too', () => {
  const compose = CLEAN.replace(
    '      NODE_ENV: production\n',
    '      NODE_ENV: production\n      DATABASE_URL: postgres://app:secret@postgres:5432/app\n      REDIS_URL: redis://redis:6379/0\n',
  )
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /backend\.DATABASE_URL \(line \d+\)/)
    assert.match(res.out, /backend\.REDIS_URL \(line \d+\)/)
    assert.match(res.out, /\$\{SERVICE_NAME_REDIS:-redis\}/)
  })
})

test('a URL whose host is the SERVICE_NAME_ form is green, and a scheme that spells a service name is not a host', () => {
  const compose = CLEAN.replace(
    '      NODE_ENV: production\n',
    '      NODE_ENV: production\n      REDIS_URL: redis://${SERVICE_NAME_REDIS:-redis}:6379/0\n',
  )
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 0, res.out)
  })
})

test('a service written in another indentation is RED, not silently skipped', () => {
  const compose = CLEAN.replace('  redis:\n    image: redis:7-alpine\n', '   redis:\n     image: redis:7-alpine\n')
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /line \d+/)
    assert.match(res.out, /indent/i)
  })
})

test('an environment line the scanner cannot read is RED, not silently skipped', () => {
  const compose = CLEAN.replace('      NODE_ENV: production\n', '      NODE_ENV: production\n      WEIRD_ENTRY\n')
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /environment line \d+/)
  })
})

test('an evenly re-indented service (keys at six, entries at ten) is still read, and its violations found', () => {
  const compose = `services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: app
  backend:
      image: example/backend
      environment:
          DB_HOST: postgres
          SEED_DEV_DATA: \${SEED_DEV_DATA:-}
          BOOTSTRAP_OWNER_PASSWORD: \${BOOTSTRAP_OWNER_PASSWORD:-}
`
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /backend\.DB_HOST \(line 9\)/)
    assert.match(res.out, /backend\.SEED_DEV_DATA \(line 10\)/)
    assert.match(res.out, /backend\.BOOTSTRAP_OWNER_PASSWORD \(line 11\)/)
  })
})

test('a service nested under another service by indentation makes its environment: unread — and that refuses a verdict', () => {
  const compose = `services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: app
    backend:
      image: example/backend
      environment:
        DB_HOST: postgres
`
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /environment:.*line 8/)
    assert.doesNotMatch(res.out, /conventions hold/)
  })
})

test('a service name padded inside quotes, or inside a comma-separated host list, is still a bare hostname', () => {
  const compose = CLEAN.replace(
    '      NODE_ENV: production\n',
    '      NODE_ENV: production\n      HOST_PADDED: "postgres "\n      REDIS_HOSTS: cache,redis:6379\n',
  )
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /backend\.HOST_PADDED \(line \d+\)/)
    assert.match(res.out, /backend\.REDIS_HOSTS \(line \d+\)/)
    assert.match(res.out, /\$\{SERVICE_NAME_REDIS:-redis\}/)
  })
})

test('a path that merely starts with a service name is not a hostname, while a URL host followed by a path is', () => {
  const compose = CLEAN.replace(
    '      NODE_ENV: production\n',
    '      NODE_ENV: production\n      APP_ROOT: backend/dist\n',
  )
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 0, res.out)
  })
  const url = CLEAN.replace('      NODE_ENV: production\n', '      NODE_ENV: production\n      DATABASE_URL: postgres://app@postgres/app\n')
  withFixture(url, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /backend\.DATABASE_URL/)
  })
})

test('a trailing comment on the environment: line does not hide the block', () => {
  const compose = CLEAN.replace(
    '    environment:\n      DB_HOST: ${SERVICE_NAME_POSTGRES:-postgres}\n',
    '    environment:  # forwarded to the container\n      DB_HOST: ${SERVICE_NAME_POSTGRES:-postgres}\n      SEED_DEV_DATA: ${SEED_DEV_DATA:-}\n',
  )
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /backend\.SEED_DEV_DATA \(line \d+\)/)
  })
})

test('a quoted value with a trailing comment is unquoted and still checked; a # inside quotes is not a comment', () => {
  const compose = CLEAN.replace(
    '      DB_HOST: ${SERVICE_NAME_POSTGRES:-postgres}\n',
    "      DB_HOST: 'postgres'  # legacy name\n      TOKEN: \"abc#def\" # real comment\n",
  )
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /backend\.DB_HOST \(line \d+\)/)
    assert.doesNotMatch(res.out, /backend\.TOKEN/)
  })
})

test('a service name as a word in free text is not a hostname; a member of a comma-separated list is', () => {
  const compose = CLEAN.replace(
    '      NODE_ENV: production\n',
    '      NODE_ENV: production\n      MOTD: welcome to the backend\n      HOSTS: cache,redis\n',
  )
  withFixture(compose, (dir) => {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.doesNotMatch(res.out, /backend\.MOTD/)
    assert.match(res.out, /backend\.HOSTS \(line \d+\)/)
  })
})

test('a key on the sibling-hostname allowlist may carry a service name and says why', async () => {
  const { scan } = await import('./compose-conventions.mjs')
  const compose = CLEAN.replace('      NODE_ENV: production\n', '      NODE_ENV: production\n      LEGACY_HOST: postgres\n')
  withFixture(compose, (dir) => {
    const strict = scan(dir)
    assert.ok(strict.findings.some((f) => f.includes('backend.LEGACY_HOST')), strict.findings.join('\n'))
    const relaxed = scan(dir, undefined, new Map([['backend.LEGACY_HOST', 'a fixture reason']]))
    assert.deepEqual(relaxed.findings, [])
    assert.deepEqual(relaxed.hostAllowlisted, ['backend.LEGACY_HOST'])
  })
})

test('a compose with no environment entries at all refuses a verdict instead of passing', () => {
  withFixture('name: fixture\nservices:\n  redis:\n    image: redis:7-alpine\n', (dir) => {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /scanned ZERO/)
  })
})

test('a missing compose file is RED with the path, not a crash', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compose-conventions-empty-'))
  try {
    const res = run(dir)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /docker-compose\.prod\.yml/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the real docker-compose.prod.yml follows both conventions', () => {
  const res = run()
  assert.equal(res.status, 0, res.out)
  assert.match(res.out, /^compose: conventions hold/)
})
