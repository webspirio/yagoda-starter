# Shared by the ticket / ticket-review scripts. Source it; don't run it.
# Nothing personal lives here: «me» is whoever `gh` is logged in as.

set -euo pipefail

OWNER=webspirio
REPO=webspirio/yagoda-starter
PROJECT_NUMBER=4          # «Main board»
BOT_LOGIN=swefd           # the automated PR reviewer

die() { echo "error: $*" >&2; exit 1; }

# DRY_RUN=1 prints every write instead of doing it; reads still run.
run() {
  if [[ "${DRY_RUN:-0}" == 1 ]]; then { printf 'DRY_RUN:'; printf ' %q' "$@"; echo; } >&2; else "$@"; fi
}

me() { gh api user --jq .login; }

repo_root() { git rev-parse --show-toplevel; }

# The main checkout (not a worktree): the first entry of `git worktree list`.
main_checkout() { git worktree list --porcelain | awk '/^worktree /{print $2; exit}'; }

project_id() { gh project view "$PROJECT_NUMBER" --owner "$OWNER" --format json --jq .id; }

status_field_json() {
  gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json \
    --jq '.fields[] | select(.name=="Status")'
}

# Option id for a Status NAME — looked up, never hard-coded, so a renamed or
# re-created option fails loudly instead of writing the wrong status.
status_option_id() {
  local name=$1 id
  id=$(status_field_json | jq -r --arg n "$name" '.options[] | select(.name==$n) | .id')
  [[ -n "$id" ]] || die "no Status option «$name» on the board; options: $(status_field_json | jq -r '[.options[].name]|join(", ")')"
  echo "$id"
}

status_field_id() { status_field_json | jq -r .id; }

# Board item for an issue/PR URL. `item-add` returns the existing item if it is already there.
board_item_id() {
  local url=$1
  if [[ "${DRY_RUN:-0}" == 1 ]]; then
    gh project item-list "$PROJECT_NUMBER" --owner "$OWNER" --limit 1000 --format json \
      --jq ".items[] | select(.content.url==\"$url\") | .id" | head -1
  else
    gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "$url" --format json --jq .id
  fi
}

# Every lookup is assigned first: `set -e` does not stop on a failure inside a `$(…)`
# that is only an argument, so an unknown status would otherwise write an empty option.
set_status() {
  local url=$1 name=$2 item option field project
  option=$(status_option_id "$name")
  field=$(status_field_id)
  project=$(project_id)
  item=$(board_item_id "$url")
  [[ -n "$item" ]] || item="<item-for-$url>"
  run gh project item-edit --id "$item" --project-id "$project" \
    --field-id "$field" --single-select-option-id "$option" >/dev/null
  echo "board: $url → «$name»"
}

issue_url() { echo "https://github.com/$REPO/issues/$1"; }

urlencode() { jq -rn --arg s "$1" '$s|@uri'; }

# Issue numbers a PR body names with a closing keyword (English or «Закриває»). Empty, not
# an error, when there are none — callers decide what an empty answer means.
closing_numbers() {
  grep -oiE '(close[sd]?|fix(e[sd])?|resolve[sd]?|закриває)[: ]+#[0-9]+' | grep -oE '[0-9]+' | sort -u || true
}
