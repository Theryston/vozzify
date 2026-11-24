---
name: ship-pr
description: "Open a PR to dev, or paired PRs to main and dev for a production hotfix, then watch its CI and mergeability in a loop: fix red checks and merge conflicts, push to the same PR, and repeat until every check is green and the PR is mergeable. Does not merge."
disable-model-invocation: true
---

Take the current work to a PR that is **green and mergeable**, and stop
there. You never merge: the maintainer does that. Use `base=dev` for ordinary work. For a production hotfix,
follow the two-branch procedure in the root Git workflow. Open both PRs,
then run the CI loop and report the result for each. Apply corrections
to both branches when they affect the shared fix.

Follow the root `CLAUDE.md` for everything: Conventional Commits, scoped
by package, attribution lines from your context, no hook bypass, no
edits to quality configs, no test changes without the user's explicit
authorization.

## Steps

1. **Get a branch with the work.**
   - Fetch origin. Use a short-lived branch based on `origin/$base`. If the
     work started elsewhere, carry only its changes onto that base.
   - If there are uncommitted changes, review them (`git status`,
     `git diff`), run `nub run format` and commit with a Conventional
     Commit message. Never commit files you did not write for this task;
     ask the user if unsure.
   - Done when the branch has commits, the working tree is clean, and
     `git log origin/$base..HEAD` lists the work.

2. **Run the gates locally before the first push.** Run what CI runs for
   the packages you touched: `nub run lint`, `nub run check-types`,
   `nub run test:cov`, plus `nub run knip` and `nub run duplication`. If a
   gate fails, fix the code (never the test or the config) and commit.
   Done when every gate passes locally, or you stop and report the
   failure verbatim.

3. **Open the PR.** Push with `git push -u origin <branch>`, then
   `gh pr create --base "$base"`. Title: a Conventional Commit title (CI
   checks it). Body: follow the `pr` skill template, end it with the
   attribution line from your context. Done when `gh pr view --json url,baseRefName`
   returns a URL and the intended base.

4. **Loop until green and mergeable.** Each pass:
   - Wait for the checks on the current head: `gh pr checks <n> --watch`
     (run it in the background if it may exceed the foreground timeout).
   - Read mergeability: `gh pr view <n> --json mergeable,mergeStateStatus,headRefOid`.
   - If `mergeable` is `CONFLICTING`, resolve it:
     `git fetch origin "$base" && git merge "origin/$base"`. Resolve each
     conflict by understanding both sides (keep the intent of the PR and
     of the target branch), run the gates again, commit the merge and push. Merge,
     not rebase: never force-push.
   - If a check is red, read the failure:
     `gh run view <run-id> --log-failed`. Root-cause it, fix the code,
     reproduce it locally with the matching gate, commit, and push.
     A bug fix gets a test that reproduces it.
   - Push with a normal `git push`. Never `--force`, never `--no-verify`.
   - Done for this pass when the head is pushed and the loop goes back to
     waiting on the new head.

   Stop the loop and report to the user when:
   - every check is green on the latest head **and** `mergeable` is
     `MERGEABLE` (`mergeStateStatus` `CLEAN`): success;
   - a check is also red on the target branch, or fails for a reason outside the PR's
     code (flaky infra, missing secret): report the evidence, do not fix;
   - a fix needs a test change, a quality-config change or a maintainer
     decision: stop and ask, with the evidence;
   - the same check has failed on 3 consecutive fix attempts: stop and
     report what each attempt changed and what the logs said.

5. **Report.** Give the PR URL, the final head SHA, the state (green and
   mergeable, or the blocker and what it needs), and the number of fix
   rounds. Give gate failures verbatim. Say plainly if the PR is not
   mergeable.

You can use github cli or github mcp for handling the PRs.

