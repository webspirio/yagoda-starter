# Comparing the local branch with the mock, side by side

The mock parity programme (`docs/superpowers/specs/2026-09-17-yagoda-mock-parity-programme.md`)
is reviewed screen by screen: the branch under work runs on the left, the reference mock
on the right, and the owner compares the same screen in both before a slice becomes a PR.

## One command

```bash
scripts/compare-with-mock.sh
```

It checks that the starter's dev stack answers on `http://localhost:5173` (start it with
`docker compose up -d`), starts the mock's Vite dev server on `http://localhost:5174` if it
is not running, and opens two Chromium windows — each with its own profile under
`~/.local/state/yagoda-compare/`, so you sign in once per window and both logins persist.
Without Chromium it falls back to `xdg-open` for both URLs.

The mock is expected next to this repo, at `../yagoda-crm`. First-time setup:

```bash
gh repo clone webspirio/yagoda-crm ../yagoda-crm
cd ../yagoda-crm && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
```

Overrides: `YAGODA_MOCK_DIR`, `MOCK_PORT`, `STARTER_URL`, `BROWSER_BIN`, `COMPARE_WIDTH`,
`COMPARE_HEIGHT` (defaults 960×1040, half of a 1920-wide screen each; on Wayland the
compositor places windows, so tile them with Super+Left / Super+Right if needed). The
GitHub Pages build at https://webspirio.github.io/yagoda-crm/ is the same code as the
clone's `main` and works as the right-hand window too.

**What the left window shows** is whatever branch is checked out in the main worktree —
the dev container bind-mounts `frontend/src`, so an edit shows within a second. A branch
that adds a dependency needs `docker compose up -d --build frontend`.

## Sign-ins

| App | Owner | Operator (Шипинки) | Other operators |
|---|---|---|---|
| Local branch | `admin` / `admin` | `oksana` / `operator` | `maria`, `taras`, `ihor`, `bohdan`, `lesia` / `operator` |
| Mock | `owner` / `1111` | `p1` / `1111` | `p2`…`p5`, `p1b` / `1111` |

Compare like with like: owner against owner, operator against operator.

## Same screen on both sides

The mock has no URL routing — navigate it through the sidebar; it remembers the last
screen. The starter's routes:

| Mock sidebar | Local branch |
|---|---|
| Прийомка | `/reception` |
| Ящики | `/crates` |
| Каса за день | `/day` (seeded day: `/day?date=2026-09-15`) |
| Каса точки | `/point-cash` |
| Ціни дня | `/prices` |
| Постачальники, картка | `/suppliers`, `/suppliers/:id` |
| Залишки | `/debts` |
| Журнал | `/journal` |
| Зведення | `/` |
| Перекази | `/transfers` |
| Точки | `/points` |
| Тара і сорти | `/catalog` |
| Собівартість дня, Переважування, Середня ціна по мережі, Аркуш керівника | not built (nav shows them disabled) |
| — | `/users`, `/profile`, `/ui-kit` (starter-only) |

## Data on each side

- The mock's business day is fixed at **4 серпня 2026** with a full demo season; «Скинути
  демо-дані» in its sidebar restores the seed if a trial receipt got in the way.
- The starter shows the seeded dataset (`npm run db:seed`, idempotent): curated shifts on
  the seed's «today» and «yesterday» plus a deterministic 30-day history. Money screens
  scope by the date stepper, so step back to a seeded day when today is empty.
- Numbers will not match between the two sides and are not meant to; layout, panels,
  columns, dialogs, copy and behaviour are what the comparison is for.

## Reading the comparison against the checklist

Each screen's divergence list lives in
`docs/superpowers/specs/2026-09-17-yagoda-mock-parity-audit.md`. A slice's PR marks every
line of its screen `ported` / `deferred → D-n` / `not ported (rule)`; the two windows are
how the reviewer checks the marks. Keep the light theme on the left while comparing — the
mock has no dark palette.
