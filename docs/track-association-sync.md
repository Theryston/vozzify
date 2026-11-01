# Synchronize existing Track associations

The Music catalog owns the `trackId` search projection. Run synchronization
when deploying the direct catalog search path for the first time or when
recovering a lost catalog projection. For the usage score rollout, deploy in
this order:

1. Deploy and migrate the Music catalog first. It installs the compatible
   association schema, canonical Meilisearch ranking rules, and partial
   document updates while existing search remains available.
2. Deploy and migrate the API. Its durable outbox publishes absolute scores
   and monotonic per-Track revisions atomically with score changes.
3. Run `nub run sync:track-associations --filter=api` with the API's normal
   production environment. It reads every Track in bounded keyset pages,
   including Tracks without a completed Processing, and publishes its exact
   Recording MBID, Track ID and current score through the authenticated
   durable outbox.
4. Wait for the command to exit successfully. It waits for catalog
   acknowledgments for each page and drains concurrent pending events before
   returning. An error exits nonzero; fix the underlying outage and rerun the
   same command from the beginning.

The command is safe to rerun. A unique outbox row per Track is reset to pending
with the current Track/Recording pair, score and revision, so acknowledged
projections are restored if the catalog projection is lost. Older snapshot
pages cannot overwrite a newer live score or lease. Each page advances the
source revision while holding Track row locks through outbox commit. That lets
an operator rerun recover from a writer that changed the score without a
revision during a rollback or mixed-version rollout. Track creation and score
refresh continue writing durable events while synchronization runs; those
events are included in the final drain and the normal worker keeps delivering
new events. This is an explicit operation, not a scheduled daily scan.

## Rollback

Roll back the API first to stop score publication, then roll back the Music
catalog. Keep the added database columns and Meilisearch score field/ranking
through the rollback: they are additive and preserving them keeps the last
known revisions and boosts available if the rollout is retried. The previous
catalog version ignores the additive index field. If reverting the search
order is also desired, remove `businessScore:desc` from the recordings index
ranking rules after the API publisher is stopped. Reindex with the previous
catalog version only if removing stored boost fields is desired; this is not
required for rollback. No production deployment or synchronization was
performed as part of this change.
