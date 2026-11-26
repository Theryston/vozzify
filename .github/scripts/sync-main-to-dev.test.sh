#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf -- "$test_dir"' EXIT

origin="$test_dir/origin.git"
author="$test_dir/author"
runner="$test_dir/runner"

git init --quiet --bare --initial-branch=main "$origin"
git clone --quiet "$origin" "$author"
git -C "$author" config user.name 'Sync test'
git -C "$author" config user.email 'sync@example.com'

commit_file() {
  printf '%s\n' "$2" > "$author/$1"
  git -C "$author" add "$1"
  git -C "$author" commit --quiet -m "test: write $1"
}

remote_tip() {
  git --git-dir="$origin" rev-parse "refs/heads/$1"
}

run_sync() {
  (cd "$runner" && bash "$script_dir/sync-main-to-dev.sh")
}

commit_file shared.txt base
git -C "$author" branch dev
git -C "$author" push --quiet origin main dev
git clone --quiet "$origin" "$runner"

# When dev is behind, reuse the existing main commit.
commit_file main.txt main
git -C "$author" push --quiet origin main
run_sync
[[ $(remote_tip dev) == "$(remote_tip main)" ]]

# A merge preserves both histories and stays a no-op when rerun.
git -C "$author" switch --quiet dev
git -C "$author" merge --ff-only --quiet origin/main
commit_file dev.txt dev
git -C "$author" push --quiet origin dev
dev_before=$(remote_tip dev)
git -C "$author" switch --quiet main
commit_file hotfix.txt hotfix
git -C "$author" push --quiet origin main
main_before=$(remote_tip main)
run_sync
merged=$(remote_tip dev)
[[ $(git --git-dir="$origin" show -s --format=%P "$merged") == "$dev_before $main_before" ]]
[[ $(git --git-dir="$origin" show "$merged:dev.txt") == dev ]]
[[ $(git --git-dir="$origin" show "$merged:hotfix.txt") == hotfix ]]
run_sync
[[ $(remote_tip dev) == "$merged" ]]
[[ $(remote_tip main) == "$main_before" ]]

# A concurrent dev push must be included when the workflow retries.
git -C "$author" switch --quiet dev
git -C "$author" pull --ff-only --quiet origin dev
commit_file concurrent.txt concurrent
git -C "$author" switch --quiet main
commit_file release.txt release
git -C "$author" push --quiet origin main
mkdir "$test_dir/hooks"
git -C "$runner" config core.hooksPath "$test_dir/hooks"
cat > "$test_dir/hooks/pre-push" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
rm -- "$0"
git -C "$SYNC_TEST_AUTHOR" push --quiet origin dev
HOOK
chmod +x "$test_dir/hooks/pre-push"
SYNC_TEST_AUTHOR="$author" run_sync
[[ $(git --git-dir="$origin" show "$(remote_tip dev):concurrent.txt") == concurrent ]]
git --git-dir="$origin" merge-base --is-ancestor "$(remote_tip main)" "$(remote_tip dev)"

# Conflicting changes must leave both remote tips intact.
git -C "$author" switch --quiet dev
git -C "$author" pull --ff-only --quiet origin dev
commit_file shared.txt dev
git -C "$author" push --quiet origin dev
dev_before=$(remote_tip dev)
git -C "$author" switch --quiet main
commit_file shared.txt main
git -C "$author" push --quiet origin main
main_before=$(remote_tip main)
if run_sync > "$test_dir/conflict.log" 2>&1; then
  echo 'Expected the sync to fail on a merge conflict.' >&2
  exit 1
fi
grep -q 'CONFLICT.*shared.txt' "$test_dir/conflict.log"
[[ $(remote_tip dev) == "$dev_before" ]]
[[ $(remote_tip main) == "$main_before" ]]

echo 'Sync main to dev tests passed.'
