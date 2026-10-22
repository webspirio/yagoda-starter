#!/usr/bin/env bash
# Usage: bash shots.sh <file.png> [more.png …]
# Uploads each image as a GitHub user-attachment (what Ctrl+V in the web editor does) and
# prints a markdown image line per file. Paste those lines into a PR body, an issue comment
# or a review body. Nothing is posted and nothing is committed.
source "$(dirname "$0")/lib.sh"
[[ $# -ge 1 ]] || die "usage: shots.sh <file.png> [...]"
repo_id=$(gh api "repos/$REPO" --jq .id)
for f in "$@"; do
  [[ -f "$f" ]] || die "no such file: $f"
  name=$(basename "$f")
  case "$name" in
    *.png) type=image/png ;; *.jpg|*.jpeg) type=image/jpeg ;; *.gif) type=image/gif ;;
    *) die "unsupported image type: $name" ;;
  esac
  if [[ "${DRY_RUN:-0}" == 1 ]]; then
    echo "DRY_RUN: upload $f"; url="https://github.com/user-attachments/assets/<uuid>"
  else
    url=$(gh api -X POST \
      "https://uploads.github.com/user-attachments/assets?content_type=${type/\//%2F}&name=$name&repository_id=$repo_id" \
      -H "Content-Type: $type" --input "$f" --jq .url)
  fi
  echo "![${name%.*}]($url)"
done
