---
name: implement-autonomously
description: Implement a requested batch of Vozzify GitHub issues with parallel ticket-implementer subagents. Unblock dependent issues as prerequisite PRs merge into dev, independently review code and rendered design, and verify the combined feature on dev without waiting for routine decisions.
---

# Implement a batch through merge into dev

When the user invokes this skill with issue numbers, take ownership of the
batch through squash merge and integration QA on `dev`. The invocation
authorizes opening and merging the batch's PRs into `dev` and making in-scope
implementation, design and test decisions. Limit writes to this batch.
Production hotfixes follow the repository's separate workflow.

Use the [original workflow](../subagents-implement/SKILL.md) for the
implementer handoff and review loop. This skill takes precedence for
dependency scheduling, decisions, QA requirements and completion. The
orchestrator owns the review and merge. The implementer owns the branch
and makes all changes. Read the repo and app instructions as usual.

## Schedule from the dependency graph

- Read each requested issue, its parent spec and relevant maintainer
  comments. Follow [issue-tracker guidance](../../../docs/agents/issue-tracker.md)
  to read all pages of GitHub's native blocker links. Check explicit
  dependencies in issue text, comments and the parent spec, including
  prerequisites outside the batch. Treat issue numbers, sub-issue order and
  shared files as scheduling hints only. Add an inferred dependency only
  when a downstream acceptance criterion requires the upstream behavior.
- Confirm prerequisites against current `origin/dev`. For a prerequisite
  delivered by PR, verify the PR merged into `dev` and its squash commit
  is reachable from `origin/dev`. Check that the required behavior is
  still present after later changes or reverts. For work delivered another
  way, verify the behavior directly on `origin/dev`. Track out-of-scope
  blockers without assigning them. Flag real cycles with the relevant
  edges and continue independent work.
- Keep a local ledger outside the repo with each issue's blockers, status,
  implementer ID, worktree, PR, reviewed head and base, QA and CI results,
  and merge commit. Reconcile it with GitHub and fetched refs after
  interruptions. Resume the same worktree and PR where possible. If a
  related PR already exists, verify scope and ownership before resuming it
  or use its verified merge as evidence.
- Fill available implementer slots with ready issues, prioritizing work
  that unlocks others. Give each issue one `ticket-implementer` in its own
  worktree branched from freshly fetched `origin/dev`. In Codex, use the
  `ticket-implementer` role and verify its worktree isolation. Pass issue
  and spec pointers, prerequisite merge SHAs, sibling overlap, and this
  skill's test decision protocol. Have it open its PR against `dev`,
  report the PR and head, then resume the same implementer for each fix
  and CI round. Coordinate shared services and serialize only work that
  would otherwise interfere.
- Recompute readiness whenever a prerequisite merges, an agent slot
  opens, or an external blocker changes. Dispatch newly ready issues
  immediately as capacity permits. Review available PRs and monitor CI
  while implementation continues. There is no batch-wide review or
  dispatch barrier.

## Make the maintainer decisions

Resolve ambiguity using the issue, parent spec, repository rules and
established product behavior. Choose the smallest reversible decision
consistent with that evidence. Record material decisions in the PR and
final report. If a decision requires authority beyond the invocation,
record the concrete blocker and keep working on the independent issues.

When an existing test fails, has become misleading, or needs to reflect a
deliberate behavior change, have the implementer identify the test, the
contract it asserts and the evidence for the proposed change. Check whether
it exposes a regression in behavior that should still hold. Send
regressions back as code fixes. When the existing assertion conflicts with
the agreed behavior or fails to assert its intended contract, the
orchestrator can authorize the specific edit on the user's behalf. Give
the implementer the test and the expected contract in the task message.
Require equivalent or stronger coverage of preserved behavior and an
assertion that can catch the relevant regression. Record which tests
changed and why in the PR. Keep quality configs and thresholds intact.
Skipping, weakening or retrying a test to hide a failure is a review blocker.

## Review and verify each PR

1. Verify the PR's issue, target, scope and head. Review standards and spec
   using [code-review](../code-review/SKILL.md) against the fetched base,
   with the issue and parent spec as the acceptance criteria. Inspect the
   implementation, tests, boundary cases, and compatibility with any
   sibling changes already on `dev`. The parent owns the conclusion and
  can review both axes directly when reviewer slots are occupied.
2. In your own QA worktree, run the exact head integrated with the current
   `dev` base and use the real integrations. Exercise every acceptance
   criterion through its normal entry point and inspect relevant logs.
   For web flows, use a real browser with a clean relevant console and
   server logs. For native flows, use the applicable simulator, emulator
   or device. Include visitor and signed-in paths, failures and empty
   states where relevant. For service-only changes, use the real affected
   API, worker or client path.
3. For any UI or visible behavior, read [DESIGN.md](../../../DESIGN.md)
   and visually inspect the rendered screens and states yourself. Check
   mobile and desktop where applicable, including 360px web width, in
   light and dark. Inspect visual hierarchy, typography, spacing, layout,
   contrast, tokens, components, focus, touch targets, motion, state
   transitions and locale-dependent layout. Compare with established
   Vozzify screens and the applicable design-system sections. Treat an
   off-spec or visibly rough result as a merge blocker even if automated
   checks pass. Send it to the owning implementer immediately with a
   screenshot or precise reproduction, the design rule or comparable
   screen, and the expected result. Review the correction in the rendered
   UI. If an essential QA surface is unavailable, try another authorized
   local runtime or a matching real preview. Hold the affected PR if
   required evidence still cannot be obtained.
4. Send every other blocking finding to the same implementer with the
   reproduction or code pointer and the expected behavior. Have it
   reproduce bugs with tests, fix the PR, run the repository gates, and
   drive its CI to green. Review every pushed delta and repeat affected
   QA. Use CI logs and local checks to distinguish code failures from
   transient runner failures or failures already on the base. Retry
   transient failures with evidence and backoff. Escalate a persistent
   external failure to the ledger and continue independent work.

## Merge and verify the batch

Serialize merge decisions. Before merging, check the current target,
head, base, required approvals and check results. Review and QA must cover
the merge candidate, and all applicable CI must pass on the current head.
If the base has moved, refresh the candidate, recheck interactions and
rerun affected QA. Have the implementer update the branch and rerun CI when
the changes or protection rules require it. Squash merge with
`gh pr merge <pr> --squash --match-head-commit <reviewed-head>` where
supported, or use the required GitHub merge queue and watch it through
completion. Respect branch protection and required independent approvals.
After GitHub confirms the merge, fetch `origin/dev` and verify the merge
SHA is reachable. If the merge commit has a different first parent from
the tested base, check the affected flows on the merged revision before
releasing dependents. A queued merge does not release them.

After the last merge, verify the requested end-to-end feature on a fresh
checkout of the resulting `origin/dev` SHA with the real required
integrations. Check the combined paths across issues and validate an
existing development preview if it serves that revision. If integration
QA finds an in-scope regression, send it to the owning implementer for a
follow-up PR against `dev` and apply the same review, QA and merge gates.
Repeat integration QA on the new `dev` head.

Stay on the run while an implementer, check, queue or recoverable failure
can move the batch forward. Poll external prerequisite PRs with an active
path to merge while the run can still benefit from them. When no further
authorized progress is possible, report the evidenced blockers and the
issues waiting on them.
Report each requested issue's PR and merge SHA or blocker, test decisions,
and the verified `dev` SHA with the development preview or local test
entry point. Call the batch complete only when every requested issue is
verified on `dev` and combined QA passes there.
