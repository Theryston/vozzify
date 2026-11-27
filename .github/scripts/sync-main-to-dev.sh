#!/usr/bin/env bash
set -euo pipefail

previous_dev=''
for _ in 1 2 3; do
  git fetch --no-tags origin \
    refs/heads/main:refs/remotes/origin/main \
    refs/heads/dev:refs/remotes/origin/dev

  if git merge-base --is-ancestor origin/main origin/dev; then
    echo 'dev already contains every commit from main.'
    exit 0
  fi

  dev_tip=$(git rev-parse origin/dev)
  if [[ "$dev_tip" == "$previous_dev" ]]; then
    echo '::error::Could not push the main merge to dev. See the Git error above.'
    exit 1
  fi
  if [[ -n "$previous_dev" ]]; then
    echo 'dev advanced during the push. Retrying from its latest commit.'
  fi

  git switch --detach "$dev_tip"
  if ! git -c user.name='github-actions[bot]' \
    -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    merge --ff --no-edit -m 'chore(repo): merge main into dev' origin/main; then
    echo '::error::Could not merge main into dev. See the Git error above.'
    exit 1
  fi

  if git push origin HEAD:refs/heads/dev; then
    exit 0
  fi

  # A PR may have landed on dev after the fetch. Rebuild on its new tip.
  previous_dev="$dev_tip"
done

echo '::error::Could not push the main merge to dev after three attempts.'
exit 1
