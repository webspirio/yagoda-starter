# Vendored files under `.claude/`

Some of what lives under `.claude/` was copied verbatim from upstream open-source
repositories. This file records where each piece came from, at which commit, and
under what licence.

**These are vendored copies.** Nothing here is a submodule, a package dependency,
or a symlink — upstream changes do **not** flow in automatically. Re-vendoring
means re-running the setup job that produced these files (clone the two upstreams
again at their current HEAD, re-copy the paths below, and update the SHAs in this
table).

## Vendored paths

| Path | Upstream | Commit | Licence | Copyright |
|---|---|---|---|---|
| `.claude/skills/requesting-code-review/SKILL.md` | https://github.com/obra/superpowers | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` | MIT | Copyright (c) 2025 Jesse Vincent |
| `.claude/skills/requesting-code-review/code-reviewer.md` | https://github.com/obra/superpowers | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` | MIT | Copyright (c) 2025 Jesse Vincent |
| `.claude/agents/code-reviewer.md` | https://github.com/anthropics/claude-plugins-official | `3ea32df27be71d78775e627df2382fc26203577f` | Apache-2.0 | Copyright Anthropic |
| `.claude/agents/silent-failure-hunter.md` | https://github.com/anthropics/claude-plugins-official | `3ea32df27be71d78775e627df2382fc26203577f` | Apache-2.0 | Copyright Anthropic |
| `.claude/agents/pr-test-analyzer.md` | https://github.com/anthropics/claude-plugins-official | `3ea32df27be71d78775e627df2382fc26203577f` | Apache-2.0 | Copyright Anthropic |
| `.claude/agents/type-design-analyzer.md` | https://github.com/anthropics/claude-plugins-official | `3ea32df27be71d78775e627df2382fc26203577f` | Apache-2.0 | Copyright Anthropic |
| `.claude/agents/comment-analyzer.md` | https://github.com/anthropics/claude-plugins-official | `3ea32df27be71d78775e627df2382fc26203577f` | Apache-2.0 | Copyright Anthropic |
| `.claude/agents/code-simplifier.md` | https://github.com/anthropics/claude-plugins-official | `3ea32df27be71d78775e627df2382fc26203577f` | Apache-2.0 | Copyright Anthropic |

Source paths upstream:

- `skills/requesting-code-review/` in `obra/superpowers`
- `plugins/pr-review-toolkit/agents/` in `anthropics/claude-plugins-official`

## Licence texts

Full upstream licence texts are kept alongside the code:

- `.claude/licences/superpowers-MIT.txt` — MIT, for `obra/superpowers`
- `.claude/licences/pr-review-toolkit-APACHE-2.0.txt` — Apache-2.0, for `anthropics/claude-plugins-official`

## Behaviour notes on the vendored agents

The agent files are byte-for-byte upstream copies, which means they describe
upstream's conventions, not this repository's. Three consequences are worth
knowing before dispatching them, none of them defects in the copy itself:

- **`code-simplifier` writes code; the other five only report.** It is
  documented as applying refinements (`code-simplifier.md:45`) and as operating
  "autonomously and proactively, refining code immediately after it's written"
  (`code-simplifier.md:88`). `pr-review/SKILL.md` §7 requires a dispatched agent
  never to modify the repository, so a PR review must not dispatch this one —
  a run that did would leave a dirty tree and corrupt every later `git diff` in
  the same session. It is kept here as a refactoring agent for ordinary
  development sessions, not as a reviewer.
- **`code-simplifier` cites coding standards this repository never adopted.**
  `code-simplifier.md:49-56` attributes to "CLAUDE.md" a list including ES
  modules with import sorting, `function` over arrow functions, and "avoid
  try/catch when possible". None of those rules appear in this repo's root,
  `backend/` or `frontend/` `CLAUDE.md`, and the last one runs against the Nest
  service layer's exception handling. Treat that list as upstream's house style
  and ignore it here.
- **`code-reviewer` emits only two severity tiers.** It reports issues at
  confidence ≥ 80 only (`code-reviewer.md:41`) and buckets them Critical or
  Important (`code-reviewer.md:52`). It cannot produce the Minor tier that
  `pr-review/SKILL.md` §6 asks for, so Minor findings have to come from the
  reviewer's own pass or from an explicit override in the briefing.
- **Two agents pin a model.** `code-reviewer.md:4` and `code-simplifier.md:40`
  set `model: opus`; the other four use `model: inherit`. That split is
  upstream's and was preserved deliberately — it is not an oversight to
  "fix" while re-vendoring.

## Not vendored

`.claude/skills/pr-review/SKILL.md` is **this repository's own file**, written for
this project. It is not vendored, has no upstream, and is ours to edit freely — it
defines how pull requests in this repository get reviewed.
