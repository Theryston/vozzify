# Drain the legacy Processing backlog

After migration groups are prepared and legacy Artist/Album maps and Track
relationships are imported, run the backlog command from `apps/api`:

```sh
nub run drain:legacy-processing-backlog
```

Set `LEGACY_PROCESSING_CONCURRENCY` in the API environment to a value from 1
through 10. It defaults to 2. The command admits no more than that many active
migration Processings at once and waits for each to reach a terminal status
before admitting additional work. Slots remain occupied while YouTube audio
work or a saved RunPod job is being polled.

Lowering the limit does not revoke already accepted durable admissions,
including an interrupted enqueue. Those attempts resume and drain first;
new admissions wait until the active count is below the new limit. Keep the
same limit on the operator command and API workers.

Run the API workers against the same destination database and Redis queue.
The command uses the API's normal Redis, S3, YouTube, RunPod and lyrics
configuration. It does not retry final failures. If interrupted, run it again:
durable admissions and saved RunPod job IDs resume the existing attempts.

Progress logs report queued, admitted, running, completed and failed counts.
The command exits successfully only after every prepared migration attempt is
terminal. Inspect failed Processings through the ordinary Track Processing
read path; their Tracks and Legacy ID maps remain available.
