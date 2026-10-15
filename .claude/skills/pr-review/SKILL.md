---
name: pr-review
description: Use when reviewing an open pull request in this repository — from the scheduled cloud routine, or by hand. Defines the review dimensions, the mergeability and code-quality scoring rubrics, and the exact comment format posted to the PR.
---

# Reviewing a pull request

You are the REVIEWER of someone else's pull request, not its author. Your output is one comment per PR, in the format below.

`gh` is NOT installed in the cloud routine environment. Use the GitHub MCP tools — `mcp__github__list_pull_requests`, `mcp__github__pull_request_read` (`get`, `get_comments`, `get_files`, `get_diff`), `mcp__github__add_issue_comment` — and load any you need with ToolSearch. `get_files` on a large PR can blow the token limit, so read code with local `git` (`git fetch origin <ref>`, then `git diff`, `git show`, `git log`) and use the MCP tools for PR metadata and comments.

## 1. Select

List open PRs (number, title, draft, head, base, html_url, updated_at).

- **Skip drafts.** A PR with `draft=true` is out of scope: never review it, never comment on it.
- **Skip what is unchanged.** Every comment ends with `<!-- auto-review: <full head SHA> -->`. If a comment already carries the marker for the PR's current head SHA, skip that PR. This marker is the only memory between runs, so it must always be present and exact.
- If every open PR is a draft or already reviewed, stop and report it. Post nothing.

## 2. Map the stack

Build the base-branch map across **all** open PRs, drafts included — a reviewable PR can sit on top of a draft. A PR whose base ref is another open PR's head ref is stacked on it.

- Review only the PR's own diff against its own base, never the cumulative diff to `main`. Locally: `git diff <base>...<head>` (three dots).
- Never repeat a finding that belongs to a PR lower in the stack; that PR gets its own review.

## 3. Scope

If an older `auto-review` marker exists on the PR, this is a **re-review**: diff `<old marker SHA>..<current head>`, focus on what changed, and explicitly check whether the previous findings were fixed. Otherwise review the whole diff.

## 4. Six dimensions

Read the diff, and read the surrounding files whenever the diff alone cannot settle a question. Score each dimension 1–5, or **n/a** if the PR touches nothing of that kind. A dimension you did not actually examine is n/a, never a guessed number.

1. **Correctness & logic** — wrong logic, broken edge cases, race conditions, off-by-one, bad state transitions, migration and back-compat hazards.
2. **Error handling** — silent failures, swallowed exceptions, unchecked nulls, a 500 where a 4xx belongs, missing rollback.
3. **Tests** — do they verify real behaviour rather than mocks? Are new paths and edge cases covered? Would a test actually fail if the code broke? Watch for date-bombs and other time-dependent fragility.
4. **Type design** — do types make illegal states unrepresentable? Invariants enforced at the boundary? Unsafe casts, `any`, stringly-typed data.
5. **Comments & docs** — do comments still match what the code does? Any comment the diff made false? Missing rationale on a non-obvious decision.
6. **Clarity & reuse** — duplication of something already in the repo, needless complexity, a simpler equivalent. Ignore pure style and formatting.

Severity, calibrated honestly — not everything is Critical:

| Severity | Means |
|---|---|
| **Critical** | Bugs, security holes, data loss, broken functionality. Must fix before merge. |
| **Important** | Architecture problems, missing error handling, real test gaps. Should fix before merge. |
| **Minor** | Polish, small optimisations, documentation nits. |

Report only findings verified against the actual code, each with a `file:line`. Acknowledge genuine strengths — accurate praise is what makes the rest of the review credible. Never pad a review with invented nitpicks, and never say "looks good" about code you did not read.

## 5. Score

**Mergeability (1–5) is mechanical.** Derive it from the finding counts; do not eyeball it, or the number drifts between runs and stops meaning anything.

| Findings | Score | Verdict |
|---|---|---|
| No Critical, no Important | 5 | ✅ Ready to merge |
| No Critical, 1–2 Important | 4 | ⚠️ Merge with fixes |
| No Critical, 3+ Important | 3 | ⚠️ Merge with fixes |
| Exactly 1 Critical | 2 | ❌ Do not merge |
| 2+ Critical, or broken/untestable as it stands | 1 | ❌ Do not merge |

**Code quality (1–5)** is the mean of the dimension scores actually assigned (skip n/a), to one decimal. It is deliberately independent of mergeability: a well-built PR with one critical bug scores high quality and low mergeability.

## 6. The comment

Post exactly one comment per reviewed PR with `mcp__github__add_issue_comment`, in this format. The tables are the point — keep them intact.

```markdown
## 🤖 Automated review — `<short head SHA>`

|  |  |
|---|---|
| **Verdict** | <✅ Ready to merge \| ⚠️ Merge with fixes \| ❌ Do not merge> |
| **Mergeability** | **<n>/5** |
| **Code quality** | **<n.n>/5** |
| **Blocking** | <n> critical, <n> important |
| **Base** | `<base ref>` |
| **Stack** | <Standalone \| Stacked on #<n> — reviewing this PR's own diff only> |
| **Scope** | <Full PR diff \| Delta since `<old sha>` (<n> new commits)> |
| **Size** | <n> files, +<n> / −<n> |

### Quality breakdown

| Dimension | Score | Note |
|---|---|---|
| Correctness & logic | <n>/5 | <short note> |
| Error handling | <n>/5 | <short note> |
| Tests | <n>/5 | <short note> |
| Type design | <n>/5 or n/a | <short note> |
| Comments & docs | <n>/5 | <short note> |
| Clarity & reuse | <n>/5 | <short note> |

### ✅ Strengths

- <specific, with a file reference>

### 🔴 Critical — must fix

**1. <one-line title>** — `path/to/file.ts:123`
<What is wrong.> <Why it matters: the concrete failure it causes.>
*Fix:* <how, if not obvious>

### 🟠 Important — should fix

<same shape, numbered>

### 🔵 Minor — nice to have

<same shape, numbered, one or two lines each>

### Assessment

<1–2 sentences: the technical bottom line, and what would move the verdict.>

<!-- auto-review: <full head SHA> -->
```

Rules:

- Drop any severity section with no findings — never leave an empty heading. With no findings at all, keep both tables and Strengths, and write `No issues found.` under Assessment.
- On a re-review, add a `### 🔁 Since last review` section straight after the breakdown, marking each previous finding **fixed** / **still open** / **regressed**.
- The marker line is mandatory, last, and carries the full 40-character SHA.
- **Comment only.** Do not push commits, do not submit a formal approve/request-changes review, do not merge, do not modify the repository.

## 7. Specialist agents

`.claude/agents/` holds six reviewers vendored from Anthropic's `pr-review-toolkit`, one per dimension above: `code-reviewer`, `silent-failure-hunter`, `pr-test-analyzer`, `type-design-analyzer`, `comment-analyzer`, `code-simplifier`.

Dispatch them when a PR is large enough that one pass would skim it, or when a dimension needs a specialist's depth — give each the base and head SHAs and the files in its lane, then fold what comes back into the single comment above. On a small diff, reviewing it yourself is faster and cheaper; the six dimensions are what matters, not the number of agents.

A dispatched agent reviews and reports. It never writes to the repository and never posts to GitHub — you own the one comment.
