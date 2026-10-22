#!/usr/bin/env bash
# scripts/ci/ticket-skills.test.sh — run: bash scripts/ci/ticket-skills.test.sh
# Drives the .claude/skills/{ticket,ticket-review}/scripts against a faked `gh` (every call
# logged to $T/calls) and throwaway git repos. Needs bash, git, jq. Expected: failed=0.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TK="$ROOT/.claude/skills/ticket/scripts"
TR="$ROOT/.claude/skills/ticket-review/scripts"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
check()      { if "$@";   then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (expected success): $*" >&2; fi; }
check_fail() { if ! "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (expected failure): $*" >&2; fi; }
called()     { grep -qF -- "$1" "$T/calls"; }
not_called() { ! grep -qF -- "$1" "$T/calls"; }
before()     { local a b; a=$(grep -nF -- "$1" "$T/calls" | head -1 | cut -d: -f1); b=$(grep -nF -- "$2" "$T/calls" | head -1 | cut -d: -f1); [[ -n "$a" && -n "$b" && "$a" -lt "$b" ]]; }
has()        { grep -qF -- "$2" "$1"; }

# ── the fake gh: answers by argument shape, logs every call; FAKE_* env tunes the answers ──
mkdir -p "$T/bin"
cat > "$T/bin/gh" <<'FAKE'
#!/usr/bin/env bash
echo "gh $*" >> "$FAKE_LOG"
a="$*"
case "$a" in
  "api user"*)                         echo "${FAKE_LOGIN:-me}" ;;
  *"issue view"*"--json state,assignees"*) echo "issue: ${FAKE_STATE:-OPEN}" ;;
  *"issue view"*"--json state"*)       echo "${FAKE_STATE:-OPEN}" ;;
  *"issue develop"*)                   [[ -z "${FAKE_DEVELOP_FAILS:-}" ]] || exit 1 ;;
  *"issue edit"*)                      : ;;
  "project view"*)                     echo PVT_P ;;
  "project field-list"*)               echo '{"id":"F_STATUS","options":[{"id":"O_PROG","name":"In progress"},{"id":"O_RFR","name":"Ready for review"}]}' ;;
  "project item-list"*|"project item-add"*) echo ITEM_1 ;;
  "project item-edit"*)                : ;;
  *"pr view"*"--json state,isDraft"*)  echo "${FAKE_PR_STATE:-OPEN} draft=${FAKE_DRAFT:-false}" ;;
  *"pr view"*"--json isDraft"*)        echo "${FAKE_DRAFT:-false}" ;;
  *"pr view"*"--json author"*)         echo "${FAKE_AUTHOR:-colleague}" ;;
  *"pr view"*"--json closingIssuesReferences"*) printf '%s' "${FAKE_CLOSES:-}" ;;
  *"pr view"*"--json body"*)           pr=$(awk '{for(i=1;i<=NF;i++) if($i=="view") print $(i+1)}' <<<"$a"); v="FAKE_BODY_$pr"; printf '%s\n' "${!v:-${FAKE_BODY:-}}" ;;
  *"pr view"*"--json number,state"*)   printf '%s\t%s\t%s\n' "${FAKE_PR_STATE:-OPEN}" "${FAKE_AUTHOR:-colleague}" "PR line" ;;
  *"pr view"*"--json headRefOid"*)     echo "${FAKE_HEAD:-abcdef1234567}" ;;
  *"pr list"*"--head"*)                echo "${FAKE_PR_STATE:-MERGED}" ;;
  *"pr list"*"--search"*)              printf '%s\n' ${FAKE_SEARCH:-} ;;
  "api graphql"*)                      printf '%s' "${FAKE_LINKED:-}" ;;
  *"issues/"*"/comments"*)             printf '%s' "${FAKE_BOT_BODY:-}" ;;
  "api -X POST https://uploads"*)      echo "https://github.com/user-attachments/assets/fake" ;;
  "api -X POST"*)                      : ;;
  "api repos/"*)                       echo 1 ;;
  *) echo "fake gh: unhandled: $a" >&2; exit 99 ;;
esac
FAKE
chmod +x "$T/bin/gh"
export PATH="$T/bin:$PATH" FAKE_LOG="$T/calls" DRY_RUN=0
reset() { : > "$T/calls"; unset FAKE_STATE FAKE_DEVELOP_FAILS FAKE_DRAFT FAKE_AUTHOR FAKE_CLOSES FAKE_BODY \
  FAKE_PR_STATE FAKE_SEARCH FAKE_LINKED FAKE_BOT_BODY FAKE_HEAD FAKE_BODY_11 FAKE_BODY_12 FAKE_LOGIN || true; }

echo "# 1. board: an unknown status refuses and writes nothing; a known one writes its option id"
reset; check_fail bash "$TK/board.sh" 5 "Inprogress"; check not_called "item-edit"
reset; check bash "$TK/board.sh" 5 "Ready for review" ; check called "--single-select-option-id O_RFR"

# A throwaway origin with a branch, and a «main checkout» cloned from it, with a .env.
git init -q --bare "$T/origin.git"
git clone -q "$T/origin.git" "$T/w/main" 2>/dev/null
echo ".env" > "$T/w/main/.gitignore"   # as in the real repo: a copied .env is not a change
git -C "$T/w/main" add .gitignore
git -C "$T/w/main" -c user.email=t@t -c user.name=t commit -q -m init
git -C "$T/w/main" push -q origin HEAD:main HEAD:feat/5-x HEAD:feat/6-y 2>/dev/null
echo "APP_URL=x" > "$T/w/main/.env"

echo "# 2. start: a closed issue and a malformed branch refuse before any write"
reset; export FAKE_STATE=CLOSED
check_fail bash -c "cd '$T/w/main' && bash '$TK/start.sh' 5 feat/5-x"; check not_called "issue edit"
reset; check_fail bash -c "cd '$T/w/main' && bash '$TK/start.sh' 5 x-5"; check not_called "issue develop"

echo "# 3. start: branch + worktree + .env, THEN assignee and board"
reset; check bash -c "cd '$T/w/main' && bash '$TK/start.sh' 5 feat/5-x > '$T/out'"
check test -f "$T/w/yagoda-5/.env"
check before "issue develop 5" "issue edit 5"
check called "--single-select-option-id O_PROG"
check has "$T/out" "TEST_DB_NAME=feat_5_x_test"

echo "# 4. start: a failed develop leaves the issue untouched"
reset; export FAKE_DEVELOP_FAILS=1
check_fail bash -c "cd '$T/w/main' && bash '$TK/start.sh' 6 feat/6-y 2>/dev/null"; check not_called "issue edit"

echo "# 5. handoff: refuses yourself and a draft; otherwise swaps assignee, requests review, board"
reset; check_fail bash "$TK/handoff.sh" 5 9 me
reset; export FAKE_DRAFT=true; check_fail bash "$TK/handoff.sh" 5 9 reviewer
reset; check bash "$TK/handoff.sh" 5 9 reviewer
check called "issue edit 5 --repo webspirio/yagoda-starter --remove-assignee me --add-assignee reviewer"
check called "pulls/9/requested_reviewers -f reviewers[]=reviewer"
check called "--single-select-option-id O_RFR"

echo "# 6. return-to-author: own PR refuses; body fallback (also «Закриває»); no issue → a message, not silence"
reset; export FAKE_AUTHOR=me; check_fail bash "$TR/return-to-author.sh" 9
reset; export FAKE_BODY="Опис. Закриває #7"
check bash "$TR/return-to-author.sh" 9; check called "issue edit 7 --repo webspirio/yagoda-starter --add-assignee colleague --remove-assignee me"
reset; export FAKE_BODY="Опис. Закриває #8"
check env LC_ALL=C bash "$TR/return-to-author.sh" 9; check called "issue edit 8 --repo"
reset; export FAKE_BODY="no keyword here"
check_fail bash -c "bash '$TR/return-to-author.sh' 9 2> '$T/err'"; check has "$T/err" "names no issue it closes"

echo "# 7. pr-for-issue: merged and own PRs say «ask»; the fallback keeps only real closing keywords"
reset; export FAKE_LINKED=11 FAKE_PR_STATE=MERGED
check bash -c "bash '$TR/pr-for-issue.sh' 5 > '$T/out'"; check has "$T/out" "refuses APPROVE/REQUEST_CHANGES"
reset; export FAKE_LINKED=11 FAKE_AUTHOR=me
check bash -c "bash '$TR/pr-for-issue.sh' 5 > '$T/out'"; check has "$T/out" "your own PR"
reset; export FAKE_SEARCH="11 12" FAKE_BODY_11="Closes #5" FAKE_BODY_12="took 5 minutes"
check bash -c "bash '$TR/pr-for-issue.sh' 5 > '$T/out'"
check called "pr view 11 --repo webspirio/yagoda-starter --json number"
check not_called "pr view 12 --repo webspirio/yagoda-starter --json number"

echo "# 8. wait-bot: a draft refuses; the review of the current head is found; no review → TIMEOUT, exit 2"
reset; export FAKE_DRAFT=true; check_fail bash "$TK/wait-bot.sh" 9 1
reset; export FAKE_BOT_BODY=$'| **Verdict** | ✅ Ready to merge |\n<!-- auto-review: abcdef1 -->'
check bash -c "bash '$TK/wait-bot.sh' 9 1 > '$T/out'"; check has "$T/out" "Ready to merge"
reset; set +e; bash "$TK/wait-bot.sh" 9 0 > "$T/out"; rc=$?; set -e
check test "$rc" = 2; check has "$T/out" "TIMEOUT"

echo "# 9. cleanup: refuses an open PR and unpushed commits; removes a clean, pushed, merged one"
reset; export FAKE_PR_STATE=OPEN; check_fail bash -c "cd '$T/w/main' && bash '$TK/cleanup.sh' 5 2>/dev/null"
git -C "$T/w/yagoda-5" -c user.email=t@t -c user.name=t commit -q --allow-empty -m local-only
reset; export FAKE_PR_STATE=MERGED
check_fail bash -c "cd '$T/w/main' && bash '$TK/cleanup.sh' 5 2> '$T/err'"; check has "$T/err" "not on the remote"
git -C "$T/w/yagoda-5" push -q 2>/dev/null
check bash -c "cd '$T/w/main' && bash '$TK/cleanup.sh' 5 > /dev/null"; check test ! -e "$T/w/yagoda-5"

echo "# 9b. cleanup: a merged branch deleted on the remote and pruned is removed; a closed-unmerged one is refused"
git -C "$T/w/main" worktree add -q "$T/w/yagoda-6" feat/6-y 2>/dev/null
git -C "$T/w/main" push -q origin --delete feat/6-y 2>/dev/null; git -C "$T/w/main" fetch -q --prune origin
reset; export FAKE_PR_STATE=CLOSED
check_fail bash -c "cd '$T/w/main' && bash '$TK/cleanup.sh' 6 2> '$T/err'"; check has "$T/err" "closed unmerged"
reset; export FAKE_PR_STATE=MERGED
check bash -c "cd '$T/w/main' && bash '$TK/cleanup.sh' 6 > /dev/null"; check test ! -e "$T/w/yagoda-6"

echo "# 10. shots: the file name is URL-encoded"
reset; printf 'png' > "$T/Знімок екрана.png"
check bash "$TK/shots.sh" "$T/Знімок екрана.png" > "$T/out"
check called "name=%D0%97%D0%BD%D1%96%D0%BC%D0%BE%D0%BA%20%D0%B5%D0%BA%D1%80%D0%B0%D0%BD%D0%B0.png"
check has "$T/out" "](https://github.com/user-attachments/assets/fake)"

echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
