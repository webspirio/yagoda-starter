#!/usr/bin/env bash
# Prune GHCR versions of this repo's images. Rules (spec §4.5):
#   - untagged versions: delete;
#   - versions whose tags are ONLY pr-<N> aliases, none for an open PR: delete
#     immediately (aliases are cheap to lose right away);
#   - versions whose tags are ONLY pr-* and/or sha-* (CI can tag one version
#     with both, e.g. a preview build's sha-<sha> + pr-<N>), none of them an
#     open PR's alias, and older than KEEP_SHA_DAYS: delete;
#   - anything carrying any other tag (or an open PR's alias): keep;
#   - the KEEP_RECENT_SHA newest sha-tagged versions: keep regardless of age.
#     Age alone was not enough: production's image is tagged only with its merge
#     commit, so once development pauses for KEEP_SHA_DAYS — exactly the
#     "Coolify stays as the prod runtime" case the design plans for — the next
#     weekly run would delete the image production is running.
# `--select` reads a versions JSON array on stdin and prints the ids to delete
# (used by the tests); without it, lists and deletes via `gh api`.
set -euo pipefail
GHCR_ORG=${GHCR_ORG:-webspirio}
PACKAGES=${PACKAGES:-"yagoda-starter-backend yagoda-starter-nginx"}
KEEP_SHA_DAYS=${KEEP_SHA_DAYS:-30}
KEEP_RECENT_SHA=${KEEP_RECENT_SHA:-5}
OPEN_PRS=${OPEN_PRS:-}
DRY_RUN=${DRY_RUN:-false}

select_ids() {
  local cutoff
  cutoff=$(date -u -d "@$(( $(date +%s) - KEEP_SHA_DAYS*86400 ))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
        || date -u -r "$(( $(date +%s) - KEEP_SHA_DAYS*86400 ))" +%Y-%m-%dT%H:%M:%SZ)
  jq -r --arg cutoff "$cutoff" --arg open "$OPEN_PRS" --arg keep "$KEEP_RECENT_SHA" '
    ($open | split(" ") | map(select(length>0)) | map("pr-"+.)) as $openAliases
    | ( map(select((.metadata.container.tags // []) | any(startswith("sha-"))))
        | sort_by(.created_at) | reverse | .[0:($keep | tonumber)] | map(.id)
      ) as $protected
    | .[]
    | .id as $id
    | select($protected | index($id) | not)
    | (.metadata.container.tags // []) as $tags
    | select(
        ($tags | length) == 0
        or ( ($tags | all(startswith("pr-") or startswith("sha-")))
             and ($tags | any(. as $t | $openAliases | index($t)) | not)
             and (.created_at < $cutoff) )
        or ( ($tags | all(startswith("pr-"))) and ($tags | any(. as $t | $openAliases | index($t)) | not) )
      )
    | .id'
}

if [ "${1:-}" = --select ]; then select_ids; exit 0; fi

# A 404 is the one benign failure (CI has not pushed that package yet). Every
# other failure — expired token, missing `packages` permission, GHCR_ORG not an
# org — must turn the job red: a cleanup that swallows them reports green
# forever while GHCR fills up, and nobody looks at a green weekly job.
failures=0
missing=0
total=0

for pkg in $PACKAGES; do
  echo "== $pkg"
  total=$((total + 1))
  err=$(mktemp)
  if ! versions=$(gh api --paginate -H "Accept: application/vnd.github+json" \
      "/orgs/$GHCR_ORG/packages/container/$pkg/versions?per_page=100" 2>"$err" | jq -s 'add // []'); then
    if grep -qiE 'not found|HTTP 404' "$err"; then
      echo "package does not exist yet; skipping"
      rm -f "$err"
      missing=$((missing + 1))
      continue
    fi
    echo "::error::listing versions of $pkg failed:" >&2
    cat "$err" >&2
    rm -f "$err"
    failures=$((failures + 1))
    continue
  fi
  rm -f "$err"
  ids=$(printf '%s' "$versions" | select_ids)
  [ -n "$ids" ] || { echo "nothing to prune"; continue; }
  for id in $ids; do
    tags=$(printf '%s' "$versions" | jq -r --argjson id "$id" '.[] | select(.id==$id) | (.metadata.container.tags // []) | join(",")')
    if [ "$DRY_RUN" = true ]; then echo "would delete $id [$tags]"; else
      if gh api -X DELETE "/orgs/$GHCR_ORG/packages/container/$pkg/versions/$id" >/dev/null; then
        echo "deleted $id [$tags]"
      else
        echo "::error::delete FAILED for $id [$tags]" >&2
        failures=$((failures + 1))
      fi
    fi
  done
done

# Every package 404ing is not "CI has not pushed yet", it is the wrong URL
# shape: /orgs/<name>/packages 404s for a PERSONAL account, which would leave a
# fork with a weekly job that is green forever and prunes nothing.
if [ "$total" -gt 0 ] && [ "$missing" -eq "$total" ]; then
  echo "::error::all $total package(s) 404'd under /orgs/$GHCR_ORG — if '$GHCR_ORG' is a personal account, the API path is /users/$GHCR_ORG/packages" >&2
  exit 1
fi

[ "$failures" -eq 0 ] || { echo "::error::$failures GHCR cleanup operation(s) failed" >&2; exit 1; }
