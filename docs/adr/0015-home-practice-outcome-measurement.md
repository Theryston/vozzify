# 15. Home practice outcomes use retry-identifiable raw events and existing attribution

- Status: accepted for additive event metadata; ranking values remain pending
  maintainer validation
- Date: 2026-11-05

## Context

Home events already retain feed and algorithm versions (ADR 0013), and a
`clickId` links an item click to a Track view. That view is the existing
attribution path for credited Heartbeats and saved Attempts. However, raw
impressions had no identity for an ingestion retry, and the event omitted
locale and audience, so visits could not be compared by those cohorts without
adding a separate analytics system.

## Decision

New Home events may carry optional `eventId`, `visitId`, `locale` and
`audience` metadata in their existing payload. The web uses one visit ID while
the Home page is mounted, a stable event ID for each impression, and the
existing click ID as the click event ID. Feed version and algorithm version
remain attached to each event. The API stores these fields in the existing
raw `payload`; it adds no table, index, queue, synchronous write or response
work. Older clients and stored rows remain valid.

The offline outcome report deduplicates events by visitor and event ID, counts
only distinct visits, and attributes practice through the existing
clickId → Track view → Heartbeat or Attempt chain. Its proposed sustained
practice, return window and scoring parameters are recorded in
`docs/home-practice-calibration-proposal.md`; none is a production ranking
decision. Clicks and playback are not practice outcomes. Reported association
does not establish causation.

## Consequences

- A retried impression has a stable analytical identity without imposing
  uniqueness on the month-partitioned event table.
- New cohorts can be grouped by feed algorithm version, audience and locale;
  legacy payloads without those values stay unknown rather than being
  guessed.
- Navigation continues to send events asynchronously. The report is offline
  and does not add work to Home or Practice requests.
- Selecting sustained-practice thresholds, attribution windows or ranking
  parameters remains a maintainer decision. Production changes need a
  separately reviewed algorithm version and the rollback path in ADR 0011.

## Alternatives considered

- **Infer locale from a Track view:** rejected because it excludes Home visits
  that never click and biases the denominator toward visitors who navigate.
- **Add analytics tables or a dashboard:** rejected because the raw payload
  already supports the bounded report and the issue does not call for a new
  analytics platform.
- **Activate proposed weights with the measurement code:** rejected because
  the available cohorts do not validate the numerical choices.
