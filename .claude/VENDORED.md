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

## Not vendored

`.claude/skills/pr-review/SKILL.md` is **this repository's own file**, written for
this project. It is not vendored, has no upstream, and is ours to edit freely — it
defines how pull requests in this repository get reviewed.
