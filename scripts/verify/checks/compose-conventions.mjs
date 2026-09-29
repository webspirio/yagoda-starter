#!/usr/bin/env node
/**
 * Two conventions of docker-compose.prod.yml that Coolify's preview deployments enforce the
 * hard way. Each was discovered in production first, and each lived only as a comment until
 * then (docs/coolify-deploy.md «What Coolify renames in a preview» and «Environment
 * variables in Coolify»); this row exists so the third one is caught by a script, not by a
 * deploy.
 *
 *  1. A sibling service is never addressed by its literal name. Coolify renames every
 *     service of a PR preview to `<name>-pr-<N>` and the DNS name follows, so
 *     `DB_HOST: postgres` resolves in production and dies in every preview. The form is
 *     `${SERVICE_NAME_<SVC>:-<svc>}` — Coolify publishes the real name in the deployment
 *     .env, the default keeps the standalone path on the plain one.
 *  2. No `environment:` entry is `KEY: ${KEY:-default}` (nor `-`, `:?`, `?`) unless KEY is
 *     in the allowlist below. For that exact shape — key and variable sharing a name —
 *     Coolify's compose parser replaces the value with the PRODUCTION env set's literal,
 *     previews included, and the preview env set is silently ignored. A bare `${KEY}` is
 *     kept as a reference and resolves from that deployment's own .env. A value whose
 *     variable differs from the key (`NODE_OPTIONS: …${BACKEND_HEAP_MB:-256}`,
 *     `DB_HOST: ${SERVICE_NAME_POSTGRES:-postgres}`) is left alone by the parser, and so by
 *     this check.
 *
 * Line-based on purpose: no YAML library is a dependency of the repo root. Services sit at
 * two spaces; a service's key indentation is whatever its FIRST key uses, so a service whose
 * keys sit at six and entries at ten is read the same as one at four and six. Three things
 * make the check RED with a line number instead of skipping: a line inside `services:`
 * indented neither like a service nor like the current service's keys nor deeper; an
 * environment line that is neither `KEY: value` nor `- KEY=value`; and — the guarantee that
 * a service nested under another service by indentation cannot hide — every
 * `environment:` line in the file must have been read as a service's own environment block,
 * or there is no verdict. An empty scan refuses a verdict too.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { refuseEmptyScan, scanRoot } from '../scan-root.mjs'

/**
 * The tree this check scans. `--root <dir>` / VERIFY_SCAN_ROOT so its own fixtures are
 * `mkdtempSync` directories and never the real working tree.
 */
const ROOT = scanRoot()

const COMPOSE_REL = 'docker-compose.prod.yml'

/**
 * Same-name `:-` defaults that are tolerable: keys whose value is identical in every Coolify
 * env set, so the production literal the parser injects is the right value everywhere.
 * Every entry is dated and reasoned; a key whose value ever diverges between env sets must
 * leave this list, or previews get production's value for it.
 */
const SAME_NAME_DEFAULT_ALLOWLIST = new Map([
  ['APP_TIMEZONE', '2026-09-29 — Europe/Kyiv in production and previews alike'],
  ['JWT_EXPIRES_IN', '2026-09-29 — 7d in every env set'],
  ['DB_USER', "2026-09-29 — app in every env set; also the postgres service's POSTGRES_USER"],
  ['DB_NAME', "2026-09-29 — app in every env set; also the postgres service's POSTGRES_DB"],
])

/** `${NAME:-…}`, `${NAME-…}`, `${NAME:?…}`, `${NAME?…}` at the very start of a value. */
const SAME_NAME_DEFAULT = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(:-|-|:\?|\?)/

/** @param {string} raw */
function unquote(raw) {
  const v = raw.trim()
  const quoted =
    v.length >= 2 &&
    ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"')))
  // Trim again after the slice: a hostname padded INSIDE the quotes is still that hostname.
  return quoted ? v.slice(1, -1).trim() : v
}

/**
 * @typedef {object} Entry
 * @property {string} service
 * @property {string} key
 * @property {string} value quotes stripped
 * @property {number} line 1-based
 */

/**
 * @param {string} text the compose file
 * @returns {{ services: string[], entries: Entry[] }}
 */
export function parseCompose(text) {
  /** @type {string[]} */
  const services = []
  /** @type {Entry[]} */
  const entries = []
  let inServices = false
  /** @type {string | null} */
  let service = null
  /** The indentation of the current service's keys — set by its first key line. */
  let keyIndent = 0
  let inEnvironment = false
  /** Every `environment:` line in the file, wherever it sits. */
  /** @type {number[]} */
  const environmentLines = []
  /** The ones read as a service's own environment block. */
  /** @type {number[]} */
  const environmentBlocks = []

  text.split('\n').forEach((line, i) => {
    if (/^\s*(#|$)/.test(line)) return
    const n = i + 1
    if (/^\s+environment:\s*$/.test(line)) environmentLines.push(n)
    const indent = line.length - line.trimStart().length
    if (indent === 0) {
      inServices = /^services:\s*$/.test(line)
      service = null
      inEnvironment = false
      return
    }
    if (!inServices) return
    if (indent === 2) {
      const m = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line)
      if (!m) throw new Error(`line ${n}: expected a service name at two spaces, found \`${line.trim()}\``)
      service = m[1]
      services.push(m[1])
      keyIndent = 0
      inEnvironment = false
      return
    }
    if (service === null) throw new Error(`line ${n}: indented content before any service`)
    if (keyIndent === 0) keyIndent = indent
    if (indent === keyIndent) {
      inEnvironment = /^\s+environment:\s*$/.test(line)
      if (inEnvironment) environmentBlocks.push(n)
      return
    }
    if (indent < keyIndent)
      throw new Error(
        `line ${n}: an indentation of ${indent} is neither a service (two spaces) nor a key of ` +
          `\`${service}\` (${keyIndent} spaces) — fix the line or teach the check`,
      )
    if (!inEnvironment) return
    let m = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (m) {
      entries.push({ service, key: m[1], value: unquote(m[2]), line: n })
      return
    }
    m = /^\s+-\s*(.*)$/.exec(line)
    const kv = m ? /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(unquote(m[1])) : null
    if (kv) {
      entries.push({ service, key: kv[1], value: unquote(kv[2]), line: n })
      return
    }
    throw new Error(
      `environment line ${n} in service ${service} is neither \`KEY: value\` nor \`- KEY=value\`: ` +
        `\`${line.trim()}\``,
    )
  })

  const unread = environmentLines.filter((n) => !environmentBlocks.includes(n))
  if (unread.length > 0)
    throw new Error(
      `environment: at line ${unread.join(', ')} was not read as a service's own environment ` +
        'block — a service or block is indented outside this file\'s style, and its entries ' +
        'would otherwise pass unchecked',
    )

  return { services, entries }
}

/**
 * Where a service name counts as a HOSTNAME inside a value: the whole value (`postgres`,
 * `postgres:5432`), a member of a comma- or space-separated host list (`cache,redis:6379`),
 * or the authority of a URL, after `://` or a `user:pw@` (`postgres://app@postgres/app`).
 * A scheme that happens to spell a service name (`redis://…`) is not a host — at the start,
 * `:` followed by `//` is excluded — a path that starts with a service name
 * (`backend/dist`) is not a host either, and `${SERVICE_NAME_REDIS:-redis}` never matches,
 * because nothing puts the bare name in host position.
 *
 * @param {string} service
 * @returns {RegExp}
 */
function hostnameOf(service) {
  const s = service.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
  return new RegExp(`^${s}(?=$|[,\\s]|:(?!//))|(?:://|@|[,\\s])${s}(?=$|[:/?#,\\s])`)
}

/** @param {string} service */
function serviceNameVariable(service) {
  return `SERVICE_NAME_${service.toUpperCase().replace(/[-.]/g, '_')}`
}

/**
 * @typedef {object} ScanResult
 * @property {string[]} findings
 * @property {string[]} services
 * @property {Entry[]} entries
 * @property {string[]} allowlisted the allowlisted same-name defaults actually present, sorted
 */

/**
 * @param {string} [root]
 * @param {Map<string, string>} [allowlist]
 * @returns {ScanResult}
 */
export function scan(root = ROOT, allowlist = SAME_NAME_DEFAULT_ALLOWLIST) {
  const file = path.join(root, COMPOSE_REL)
  if (!existsSync(file)) throw new Error(`${COMPOSE_REL} not found under ${root}`)
  const { services, entries } = parseCompose(readFileSync(file, 'utf8'))
  const hostnames = services.map((s) => ({ service: s, re: hostnameOf(s) }))
  /** @type {string[]} */
  const findings = []
  const allowlisted = new Set()

  for (const e of entries) {
    const m = SAME_NAME_DEFAULT.exec(e.value)
    if (m && m[1] === e.key) {
      if (allowlist.has(e.key)) allowlisted.add(e.key)
      else
        findings.push(
          `${e.service}.${e.key} (line ${e.line}): \`${e.key}: \${${e.key}${m[2]}…}\` — Coolify's ` +
            "compose parser replaces this with the PRODUCTION env set's literal, previews " +
            `included; write \`${e.key}: \${${e.key}}\` (see the docker-compose.prod.yml header), ` +
            'or allowlist the key in this check if its value is identical in every env set',
        )
    }
    for (const { service: sibling, re } of hostnames)
      if (re.test(e.value))
        findings.push(
          `${e.service}.${e.key} (line ${e.line}): bare sibling hostname \`${sibling}\` in ` +
            `\`${e.value}\` — previews rename every service to \`<name>-pr-<N>\` and the DNS ` +
            `name follows; put \`\${${serviceNameVariable(sibling)}:-${sibling}}\` in its place`,
        )
  }

  return { findings, services, entries, allowlisted: [...allowlisted].sort() }
}

function main() {
  /** @type {ScanResult} */
  let result
  try {
    result = scan()
  } catch (err) {
    process.stderr.write(`compose: RED\n  ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
    return
  }

  refuseEmptyScan('compose', result.services.length, `services in ${COMPOSE_REL}`, ROOT)
  refuseEmptyScan('compose', result.entries.length, `environment entries in ${COMPOSE_REL}`, ROOT)

  if (result.findings.length > 0) {
    process.stderr.write('compose: RED\n')
    for (const finding of result.findings) process.stderr.write(`  ${finding}\n`)
    process.exit(1)
  }

  process.stdout.write(
    `compose: conventions hold — ${result.entries.length} environment entries across ` +
      `${result.services.length} services in ${COMPOSE_REL}; same-name \`:-\` defaults ` +
      `allowlisted: ${result.allowlisted.join(', ') || 'none'}\n`,
  )
}

if (process.argv[1]?.endsWith('compose-conventions.mjs')) main()
