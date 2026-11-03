# Direct YouTube audio downloads through the regional proxy

Processing can select a video available only in Brazil, so downloading must
use a controllable exit country too. The previous conversion API does not
document a country selector. Download audio directly with `youtubei.js`
through the configured HTTP proxy and a Brazilian sticky session, without
a PO Token provider. This supersedes ADR 0004's external download decision:
we take responsibility for player deciphering and YouTube compatibility in
exchange for control over the download's region.

Use the SDK's `VISIONOS` client for audio. The `ANDROID_VR` client can return
playable metadata and serve the first MiB, then refuse the rest with HTTP
403. Full downloads of the Brazilian One Life video and the Shape of You
control, not only a successful player request, validate client selection.

The download, FFmpeg conversion and S3 upload operate on streams or temporary
files rather than complete media buffers. Each job owns a unique directory,
removes the source after conversion, and removes the directory in `finally`.
Cap source audio at 64 MiB and WAV at 256 MiB, with two-minute deadlines for
each I/O stage. S3 receives a file stream with its known content length.

The WAV object key and Processing's persisted URL stay unchanged. A replay
reuses an uploaded WAV; a queued legacy conversion wait restarts downloading
directly from its chosen video. Failures remain retryable through the
existing Processing pipeline. Regional and anti-bot failures must surface
as failures; this decision adds no token generation or external fallback.

Rollback restores the earlier downloader implementation and its API key.
No database migration or public contract change is required.
