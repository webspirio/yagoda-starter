#!/usr/bin/env bash
# scripts/ci/release-guard.sh LIVE_SHA TARGET_SHA MIGRATIONS_DIR ALLOW [MODE]
#
# Decides whether moving production from LIVE_SHA (the commit the `production`
# branch points at; empty before the first release) to TARGET_SHA (a release
# tag's commit) is safe with respect to database migrations. Migrations run on
# backend start-up (migrationsRun: true) and never roll back by themselves, so
# deploying OLDER code onto a NEWER schema is the one move this refuses — unless
# ALLOW is the literal `true`, which the workflow sets only from an explicit
# `allow_schema_rollback` input. Runs inside a checkout containing both commits;
# never touches the network. Exit 0 = proceed, exit 1 = refused.
#
# MODE is `release` or `dispatch` (default `dispatch`). A published release may
# only move production FORWARD: two releases in quick succession can finish out
# of order, and the older one must not overwrite the newer — so in `release`
# mode any backward move is refused outright. Rollbacks go only through a
# `workflow_dispatch` (`dispatch` mode), where the migration check above applies.
set -euo pipefail
live=${1-}; target=${2:?TARGET_SHA}; dir=${3:?MIGRATIONS_DIR}; allow=${4:-false}; mode=${5:-dispatch}
case "$mode" in release|dispatch) ;; *) echo "release-guard: MODE must be release or dispatch, got '$mode'" >&2; exit 1 ;; esac

if [ -z "$live" ]; then
  echo "release-guard: no production branch yet — first release, nothing to compare"
  exit 0
fi
if [ "$live" = "$target" ]; then
  echo "release-guard: production is already at $target"
  exit 0
fi
if git merge-base --is-ancestor "$live" "$target"; then
  echo "release-guard: forward move $live -> $target"
  exit 0
fi
if ! git merge-base --is-ancestor "$target" "$live"; then
  echo "release-guard: $target is neither ahead of nor behind production ($live) — refusing a sideways move; releases are cut from main" >&2
  exit 1
fi
if [ "$mode" = release ]; then
  echo "release-guard: production is already at a NEWER release ($live); publishing $target would move it backwards. A release only moves production forward — to roll back, run the workflow by hand with the tag (docs/coolify-deploy.md «Rolling back»)." >&2
  exit 1
fi
changed=$(git diff --name-only "$target" "$live" -- "$dir")
if [ -z "$changed" ]; then
  echo "release-guard: rollback $live -> $target crosses no migration"
  exit 0
fi
{
  echo "release-guard: rolling back production from $live to $target crosses these migrations:"
  echo "$changed" | sed 's/^/  /'
} >&2
if [ "$allow" = true ]; then
  echo "::warning::allow_schema_rollback=true — deploying $target onto a schema that is already at $live's level"
  exit 0
fi
cat >&2 <<'EOF'
Refusing. Migrations run on backend start-up and never roll back by themselves,
so the older code would start against the newer schema. Ship a hotfix release
instead (forward-fix), or restore last night's pair per docs/backup-restore.md;
rerun with allow_schema_rollback=true only after verifying the down path by
hand — see docs/coolify-deploy.md «Rolling back».
EOF
exit 1
