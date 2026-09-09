#!/usr/bin/env bash
# Prune GHCR versions of this repo's images. Rules (spec §4.5):
#   - untagged versions: delete;
#   - versions whose tags are ONLY pr-<N> aliases, none for an open PR: delete
#     immediately (aliases are cheap to lose right away);
#   - versions whose tags are ONLY pr-* and/or sha-* (CI can tag one version
#     with both, e.g. a preview build's sha-<sha> + pr-<N>), none of them an
#     open PR's alias, and older than KEEP_SHA_DAYS: delete;
#   - anything carrying any other tag (or an open PR's alias): keep.
# `--select` reads a versions JSON array on stdin and prints the ids to delete
# (used by the tests); without it, lists and deletes via `gh api`.
set -euo pipefail
GHCR_ORG=${GHCR_ORG:-webspirio}
PACKAGES=${PACKAGES:-"yagoda-starter-backend yagoda-starter-nginx"}
KEEP_SHA_DAYS=${KEEP_SHA_DAYS:-30}
OPEN_PRS=${OPEN_PRS:-}
DRY_RUN=${DRY_RUN:-false}

select_ids() {
  local cutoff
  cutoff=$(date -u -d "@$(( $(date +%s) - KEEP_SHA_DAYS*86400 ))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
        || date -u -r "$(( $(date +%s) - KEEP_SHA_DAYS*86400 ))" +%Y-%m-%dT%H:%M:%SZ)
  jq -r --arg cutoff "$cutoff" --arg open "$OPEN_PRS" '
    ($open | split(" ") | map(select(length>0)) | map("pr-"+.)) as $openAliases
    | .[]
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

for pkg in $PACKAGES; do
  echo "== $pkg"
  if ! versions=$(gh api --paginate -H "Accept: application/vnd.github+json" \
      "/orgs/$GHCR_ORG/packages/container/$pkg/versions?per_page=100" | jq -s 'add // []'); then
    echo "package not found or not accessible yet; skipping"
    continue
  fi
  ids=$(printf '%s' "$versions" | select_ids)
  [ -n "$ids" ] || { echo "nothing to prune"; continue; }
  for id in $ids; do
    tags=$(printf '%s' "$versions" | jq -r --argjson id "$id" '.[] | select(.id==$id) | (.metadata.container.tags // []) | join(",")')
    if [ "$DRY_RUN" = true ]; then echo "would delete $id [$tags]"; else
      if gh api -X DELETE "/orgs/$GHCR_ORG/packages/container/$pkg/versions/$id" >/dev/null; then
        echo "deleted $id [$tags]"
      else
        echo "delete FAILED for $id [$tags]" >&2
      fi
    fi
  done
done
