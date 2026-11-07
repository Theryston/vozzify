# 8. The browser pitch engine: CREPE tiny first, YIN as the fallback

- Status: accepted
- Date: 2026-10-15

## Context

With the mic on, the practice page finds the note the user sings in real time
(spec #160, ticket #169). The spec asks for a pitch ML model of about 5 MB or
less as the primary engine and a classic YIN/MPM detector as the fallback, for
devices that cannot load or keep up with the model.

## Decision

- The engine is a set of small steps in `apps/web/features/practice`: an
  AudioWorklet captures the mic with echo cancellation, noise suppression and
  auto gain off, preserving sustained singing and its harmonics instead of
  applying speech processing. Headphones isolate playback from the mic.
  The classic fallback uses a confidence
  gate, octave-slip correction and median of five. The model path instead
  keeps competing pitch peaks and corroborates them with YIN on the same
  captured frame. Hann-windowed spectral evidence checks whether a root is
  present beneath a dominant harmonic before resolving octave ambiguity.
  A temporal tracker preserves fractional slides and vibrato,
  tolerates at most 64 ms of non-silent uncertainty and confirms consistent
  large changes using capture time. Measured silence still ends the line.
  This avoids turning a brief confidence dip into a new phrase or a smooth
  slide into the median filter's sudden staircase; octaves remain measurable.
- **Primary: CREPE tiny as ONNX**, run by `onnxruntime-web` (WASM, one thread,
  so no cross-origin isolation headers are needed). The mic's audio is brought
  down to 16 kHz and read in 1024-sample frames every 32 ms.
  - Model: `apps/web/public/models/crepe-tiny.onnx`, 1,955,762 bytes, from
    <https://github.com/yqzhishen/onnxcrepe/releases/download/v1.1.0/tiny.onnx>
    (onnxcrepe v1.1.0, MIT, (c) 2022 yqzhishen). The weights come from
    marl/crepe (MIT, (c) 2018 Jong Wook Kim). Both licenses allow
    redistribution; the notice is in `public/models/NOTICE.md`.
  - The runtime's WASM (about 14 MB) is served from our own origin, from
    `public/ort`. It is copied from `node_modules` by
    `scripts/copy-ort-wasm.ts` before `dev` and `build` and is git-ignored.
  - Runtime and model are dynamic imports and fetches made when the mic turns
    on; the first-load bundle does not change. The browser caches both.
- **Fallback: YIN.** YIN answers from the first sample, so the user never waits
  for the download. The model takes over once loaded. YIN takes back for the
  rest of the session if the model fails to load, fails while running, or
  cannot keep up (8 hops in a row arrive while the previous frame is still being
  run). Which engine runs shows in debug logs only.
- The voice line uses the player's media presentation time minus capture
  latency: the mic track's input latency, half the active engine's window and
  time spent delivering and analyzing the captured frame. The worklet stamps
  each block with its render time, mapped to the page's performance clock and
  preserved through asynchronous inference. Wall-clock delays are scaled by
  playback rate before subtracting them from Track seconds.
  This replaces the original estimate that also subtracted the mic context's
  base and output latency. That context does not play the Track, and the media
  player may already account for output delay; borrowing the mic context's
  output delay can move the voice too far back, especially with Bluetooth.
  Direct audio routed through Tone reports its source head instead of the
  audible position, so that player subtracts its own context's base and output
  latency before exposing Track time. Source switches preserve the unadjusted
  media position. Unison playback bypasses PitchShift's delay lines immediately.
  When pitch processing is needed (transposition or rate correction), the player
  also subtracts half the effect's window as its nominal processing delay,
  scaled by playback rate. Browser renders at positive and negative shifts
  measured about 50 ms on average for the default 100 ms window. Instantaneous
  delay varies with modulation, so this aligns the window's center rather than
  promising sample-exact timing. Changing transposition anchors presentation
  time to prevent a backward jump while the processing delay fills.
  Calibration compares singing with the synth's estimated audible onset using
  its output timestamp (reported output latency is the fallback). Old offsets
  are reset when loading preferences because their compensation model changed;
  the other singing aids are preserved.
- The mic is released as soon as the user turns it off, leaves the page or
  hides the tab, even if it was still starting: a start that finishes late is
  stopped at once.

## Consequences

- Accuracy is judged by singing; unit regressions also cover competing
  harmonics, diffuse model confidence, interrupted and drifting octave
  candidates, real leaps, silence and slides. The e2e test checks the model
  path on a known A4. User recordings can be replayed locally to compare
  behavior without adding private audio to the repository.
- A visitor who turns the mic on downloads about 16 MB once (runtime plus
  model); later visits read it from the browser cache.
- The AudioWorklet module is a plain `.js` file next to the engine, loaded by
  `new URL(..., import.meta.url)`, because an AudioWorklet loads a file by URL
  and cannot run bundled TypeScript.
- `proxy.ts` leaves `.onnx` and `.wasm` requests alone, like other static
  assets, so they are not redirected to a locale.
