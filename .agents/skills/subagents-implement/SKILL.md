---
name: subagents-implement
description: "Implement several issues in parallel, one ticket-implementer subagent per issue, each in its own worktree and PR, then review each PR, test it in a real browser and drive its CI to green."
disable-model-invocation: true
---

`/implement`, fanned out: the user passes issue numbers, and every issue is
built by its own **implementer** (the `ticket-implementer` subagent) in its
own worktree. Ordinary issues target `dev`. For a production hotfix, the same
implementer opens both PRs required by the root Git workflow. You are the **parent**: you dispatch,
review, test each PR in a real browser, send fixes back, and report. You never edit an implementer's branch
yourself; every change goes back through the implementer that owns the PR.

Everything in `.agents/skills/implement/SKILL.md` still applies, per
issue: each implementer follows it (`/tdd` at pre-agreed seams, typecheck
and single test files regularly, full suite once at the end), and its
`/code-review` step is the parent's review in step 3.

Communicate through **context pointers** (issue numbers, PR URLs, file
paths, commit SHAs) rather than pasting content the implementer can read.

## Steps

1. **Read the issues.** For each number, `gh issue view <n> --comments`.
   Note which issues touch the same files (contracts, shared modules) and
   any blocking relationship between them. An issue blocked by another
   one in the list waits until the blocker's PR for the dependent issue’s base is merged; tell the user
   which ones you held back and why. Done when every issue is either
   dispatchable or held back with a reason.

2. **Dispatch in parallel.** In a single message, launch one
   `ticket-implementer` per dispatchable issue, in the background, each
   with worktree isolation (Claude Code: the Agent tool with
   `subagent_type: "ticket-implementer"`, `isolation: "worktree"`,
   `run_in_background: true`; OpenCode: the `task` tool with the
   `ticket-implementer` agent). Each prompt carries only:
   - the issue number and expected base(s), `dev` for ordinary work or both
     `main` and `dev` for a production hotfix;
   - "follow `.agents/skills/implement/SKILL.md` as well as your own
     instructions, skipping its `/code-review` step (the parent reviews)";
   - the sibling issues running in parallel and the shared files you saw
     overlap on, so it keeps those changes minimal and additive;
   - any test change the user explicitly authorized for that issue;
   - "stop after opening all required PRs and report their URLs; the parent will
     message you with review findings and then ask you to watch CI".

   Keep each implementer's ID: every later round goes to the same agent
   (Claude Code: SendMessage to its ID; OpenCode: resume with its
   `task_id`), so it keeps its worktree and context. Done when every
   dispatched implementer has reported every required PR URL, or a blocker.

3. **Review each PR** as soon as its implementer reports, without
   waiting for the others. Verify its target with `gh pr view <n> --json baseRefName`. Fetch
   the latest base and head, and run the `code-review` skill with
   `origin/<base>` as the fixed
   point and the issue as the spec. Read the `gh pr view <n>` body too:
   it must close the issue and list changed tests and open concerns.
   Done when the review has run and every finding is classified as
   **blocking** (a bug, a spec gap, a broken repo rule from `CLAUDE.md`)
   or **optional**.

4. **Send the findings back.** Message the PR's implementer with the
   blocking findings (file, line, what is wrong, what correct looks
   like) and the optional ones worth taking. It fixes them in its
   worktree, re-runs the gates, pushes to the same PR and reports the new
   head SHA. Re-review only what changed (`git diff <old-sha>..<new-sha>`)
   and repeat until the review is clean. A finding that needs the
   maintainer's decision goes to the user, not to the implementer.
   Done when a review of the latest head has no blocking finding.

5. **Test it in a real browser yourself.** Reading the diff and trusting
   the tests is not enough: tests run against fakes and stubs (the e2e
   fake player, mocked APIs) and only fail on what they assert, so a bug
   in the real integration or an error in the console gets through. If
   you have a browser available (a Playwright/Chromium install, a browser
   tool), run each PR's latest head and use the feature by hand. Skip this
   step only when no browser is available, and say so in the report.
   - Check out the head in a worktree of your own (`git worktree add
     <dir> origin/<branch>`); never edit or push to it. Start what it
     needs (`nub run infra:up`, `nub run dev`, or a production build)
     with the **real** integrations: no e2e flags such as the fake player.
   - Walk every acceptance criterion of the issue as a user would: as a
     visitor and signed in, on desktop and phone viewports, light and
     dark, including the error and empty states the issue names.
   - Watch the browser console and the server log the whole time. Any
     uncaught error, hydration mismatch or React warning is a blocking
     finding, even when the feature looks fine.
   - Send what fails back through step 4, with the steps to reproduce and
     the console output. The implementer adds a test that reproduces it
     before fixing it. Test the new head in the browser again.

   Done when every acceptance criterion works in the browser on the
   PR's latest head with a clean console, or you reported that no
   browser was available.

6. **Have the implementer drive CI to green.** Message it to watch CI on
   its PR in a loop until every check is green:
   - wait for the run on the current head: `gh pr checks <n> --watch`;
   - on a red check, read the failure (`gh run view <run-id> --log-failed`),
     root-cause it, fix the code, re-run the matching gate locally, push,
     and watch again;
   - a failing test means the code is wrong: fix the code, never the
     test, the gates or the quality configs;
   - a check that is also red on the PR’s base, or a failure outside the PR's
     code, is reported to the parent with the evidence instead of fixed;
   - report the PR URL and "all checks green on <sha>" when done.

   If a CI fix changed more than a few lines, review that diff as in
   step 3 and test it in the browser as in step 5 before accepting it.
   Done when the implementer reports every check green on the PR's
   latest head, or a blocker it can't fix from its PR.

7. **Report.** Once every PR is done, give the user one list: per issue,
   each PR URL, its base and state (green, reviewed and tested in the browser, or
   the blocker and what it needs), and anything held back in step 1.
   Every PR in the list has had a clean review, a clean browser test and
   green CI, or says exactly why not.
