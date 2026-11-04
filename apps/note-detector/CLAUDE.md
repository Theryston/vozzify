# apps/note-detector: Note detection worker

Read the root `CLAUDE.md` first; this file only adds this app's rules.

A **RunPod serverless** worker that replaces the legacy worker (ADR 0007). Given
a Track's music WAV it separates the vocals, uploads them, finds the Vocal
notes and computes the Pitch curve. The decision and the benchmark behind the
models are in `docs/adr/0007-note-detector-replaces-nfp-audio.md`.

It **never calls the API** and holds **no storage credentials**. Everything it
needs arrives in the job input as URLs; everything it produces leaves through
presigned uploads and the job output. It is not a library: nothing imports it.

Python, not Node. The monorepo runs it through Turbo with a thin `package.json`
that calls `uv`.

**State today:** the job contract, the handler, the Pitch curve encoding, the
transfer helpers and the image exist. All three model steps are wired:
vocal separation (Mel-Band RoFormer), Vocal notes (GAME medium) and the
Pitch curve (RMVPE). A failed step fails the whole Processing.

## The job contract

RunPod runs one job per `/run` call. The API starts the job and polls
`/status`.

Input (`job.input`, camelCase, validated in `note_detector/contract.py`):

```json
{
  "processingId": "…",
  "musicUrl": "https://…/music.wav",
  "vocalsUpload": {
    "presignedPutUrl": "https://…?X-Amz-…",
    "contentType": "audio/wav",
    "publicUrl": "https://…/vocals.wav"
  },
  "pitchCurveUpload": {
    "presignedPutUrl": "https://…?X-Amz-…",
    "contentType": "application/octet-stream",
    "publicUrl": "https://…/pitch-curve.bin"
  }
}
```

Progress: the handler reports `EXTRACTING_VOCALS` (before the download, so it
covers the whole vocal stage), then `DETECTING_NOTES`, as RunPod progress
updates. The API maps those to the Processing's statuses. The stage names are
part of the contract; do not rename them.

Output (`COMPLETED`):

```json
{
  "vocalsUrl": "https://…/vocals.wav",
  "pitchCurveUrl": "https://…/pitch-curve.bin",
  "detectorVersion": "note-detector@<git sha>",
  "notes": [{ "pitch": 61.49, "start": 1.23, "end": 1.61 }]
}
```

- `pitch` is a continuous MIDI number (A4 = 69). Clients name the nearest key.
- `start`/`end` are seconds from the start of the music. `notes` is ordered by
  time (the handler sorts them, whatever the detector returns).
- `vocalsUrl` and `pitchCurveUrl` are the `publicUrl`s the worker was given.
- Any invalid input or failed step raises, which RunPod reports as `FAILED`;
  the API maps that to `NOTE_DETECTION_FAILED`. The Pitch curve is mandatory:
  a failure to compute or upload it fails the whole job.

### The Pitch curve file

Little-endian Uint16, one value per 10 ms frame from t = 0. A value is
`round(MIDI x 100)` and `0` means no voice at that frame. Content type
`application/octet-stream`. Encoding (`pitch_curve.py`): halves round up,
unvoiced (0, negative, NaN) is `0`, a voiced frame never encodes as `0`, and
values clamp to 65535.

### Detector version

The image is built with `--build-arg GIT_SHA=<sha>`, which becomes the
`NOTE_DETECTOR_GIT_SHA` env var; the worker reports `note-detector@<sha>`
(`unknown` outside an image). Weights are pinned by checksum in the repo, so
the sha identifies code and models.

## Layout

- `note_detector/contract.py`, `handler.py`, `notes.py`, `pitch_curve.py`,
  `version.py`: pure logic, no models. The handler takes its steps as injected
  callables, so the contract is tested with fakes.
- `note_detector/transfer.py`: the music download and the presigned uploads.
- `note_detector/smoke_validation.py`: pure checks of the smoke job output,
  uploaded WAV and Uint16 Pitch curve, covered at 100% like the other pure
  modules.
- `note_detector/__main__.py`: the RunPod entrypoint, which wires the real
  steps and loads one instance of each model before starting RunPod. It fails
  before model loading when CUDA is unavailable. `smoke_test.py`
  exercises the same real steps against a local HTTP server from the built
  image; it also requires CUDA.

- Vocal separation: `separation_config.py` (the published config and the
  weights directory), `separation_plan.py` (chunks, batches, overlap-add),
  `separation_audio.py` (stereo reads, clipping) and `mel_filters.py` are pure.
  `separation.py` (torch, soundfile, yaml) is the adapter and
  `vendor/mel_band_roformer/` the vendored model; both are omitted from
  coverage.

Pure modules are covered at 100% (`fail_under = 100`); model adapters and
`vendor/` are omitted from coverage and checked by parity tests that run only
when the weights are present. Only calls into the model stack belong in an
adapter: anything it decides goes in a pure module with tests.

## Vocal separation (Mel-Band RoFormer "Kim")

- Model: Mel-Band RoFormer "Kim" vocals (`KimberleyJSN/melbandroformer`, MIT)
  with its published config from ZFTurbo's Music-Source-Separation-Training
  (`configs/KimberleyJensen/config_vocals_mel_band_roformer_kj.yaml`): stereo,
  44.1 kHz, chunk size 352800 samples.
- `vendor/mel_band_roformer/` is the model class, vendored and trimmed to
  inference from ZFTurbo's code (MIT; `LICENSE` and `NOTICE` list the
  changes). Its module names are the checkpoint's keys, so the weights load
  with `strict=True`; do not rename them. `rotary-embedding-torch` is capped
  below 0.7 because `audio-separator` (the parity reference) requires it.
- `separation_config.py` reads the published config: it takes the keys the
  inference needs, checks that the model is stereo, one stem and unnormalized,
  and fails on any key it does not know (the deliberately ignored ones are
  listed there with why). The chunk batch size comes from the config's
  `inference.batch_size`; the overlap is fixed at 4.
- `separation_plan.py` is the chunking: a hop of `chunk / overlap`, the tail
  zero-padded to a full chunk, a strictly positive triangular window and a
  weighted average where chunks overlap. `mel_filters.py` is the Slaney mel
  filter bank (what librosa computes), pinned against librosa's values.
- `separation.py` is the adapter: runs fp32 on CUDA and writes a 16-bit stereo
  44.1 kHz vocals WAV, clipped to full scale. The input must be 44.1 kHz (the
  API always sends it): any other rate fails the job instead of being
  resampled; mono is duplicated. The model loads once per worker process, at
  startup.
- Weights: `separation-weights.json` pins the checkpoint (a fixed Hugging Face
  revision) and the config (a fixed ZFTurbo commit) by sha256; the Dockerfile
  downloads them with `weights.py` into `/app/weights/mel-band-roformer`
  (override with `NOTE_DETECTOR_SEPARATION_DIR`) and a mismatch fails the
  build.
- Parity test: `tests/parity/test_separation_parity.py` (marker `parity`)
  separates a short fixture with our code and with `audio-separator` (same
  model, overlap 4, the same chunk length, no peak normalization) and requires
  a high SDR between the two. It skips itself
  without the weights, torch or the reference. Run it with
  `uv sync --group model --group parity-separation` then
  `uv run pytest -m parity tests/parity`. The fixture is synthetic unless
  `NOTE_DETECTOR_PARITY_FIXTURE` names a stereo 44.1 kHz WAV.

## Vocal notes: GAME medium (ONNX)

The Vocal notes come from GAME medium (openvpi/GAME, MIT), run from its
official ONNX release (v1.0.3, medium) on `onnxruntime-gpu`, through our own
loop that reproduces GAME's `infer.py extract`. No GAME training code, torch
or Lightning is involved.

- `game_slicer.py`: a port of GAME's `slicer2.py` with `extract`'s parameters
  (-40 dB, 1 s minimum clip, 200 ms minimum silence, 100 ms kept). The vocals
  are cut at silences. Digital zeros give no clip; noise below -40 dB counts
  as silence but each cut keeps the quietest frame, so it can leave a clip of
  up to 100 ms, as in GAME. The sample rate is the model's, not a constant.
  GAME's branch for a silence no longer than the kept silence is left out:
  those parameters never reach it.
- `game_decode.py`: the D3PM loop control (`d3pm_times`, `sample_boundaries`)
  and the decoding of boundaries into regions and of regions into notes
  (clip offset, clamping to the clip length, unvoiced regions dropped, overlap
  trimming between clips, as GAME's callbacks do).
- `game_pipeline.py`: per clip, encoder, then the segmenter's D3PM sampling,
  then the estimator, behind the `GameModules` protocol, so it is tested with
  fakes. Pure, covered at 100%.
- `game_io.py`: what the adapter feeds the graphs (inputs and dtypes, the
  graph's accepted inputs, the region count, the sample-rate guard, the
  weights directory from an injected environment). Pure.
- `game.py`: the onnxruntime adapter (omitted from coverage), only the calls
  into onnxruntime and soundfile. The three sessions (`encoder`, `segmenter`,
  `estimator`; `dur2bd`/`bd2dur` are not needed, their work is in
  `game_decode.py`) are created once per worker, in `main()`, before the first
  job. Clips run one at a time (batch 1). The sample rate and timestep come
  from the release's `config.json`, and the boundary radius is
  `round(0.02 / timestep)` frames, as `infer.py` computes it.
- `weights.py` + `game-weights.json`: the image build downloads the release
  files and checks each sha256 (see Weights).

GAME's defaults, all in `game_decode.py`: 8 D3PM steps from t0 = 0
(`t = 0, 1/8 .. 7/8`), boundary threshold 0.2, boundary radius 0.02 s (2
frames at the release's 10 ms), presence threshold 0.2, language 0 (unset: the model has no
Portuguese and "unset" measured as good as "en"). The vocals the separation
step writes are 44.1 kHz, the model's rate; any other rate fails the job.

The notes' `pitch` is GAME's continuous MIDI score of the region.

### Weights

`game-weights.json` pins the release zip (`GAME-1.0.3-medium-onnx.zip`, about
180 MB, ONNX opset 17) by url and sha256. The Dockerfile runs `weights.py`
over it (the build fails when the checksum differs), unpacks it with the
standard library and keeps the four files the worker uses in
`/app/weights/game-medium` (override with `NOTE_DETECTOR_GAME_DIR`):
`config.json`, `encoder.onnx`, `segmenter.onnx`, `estimator.onnx`. The zip also
holds `dur2bd.onnx` and `bd2dur.onnx`, which are not needed. A cold start
never touches the network.

The release's `config.json` is `samplerate` 44100, `timestep` 0.01,
`languages` `{en: 1, ja: 2, yue: 3, zh: 4}` (so the segmenter has a `language`
input; we always pass 0), `loop` true, `embedding_dim` 256. Graph inputs and
outputs, as the adapter uses them: encoder `waveform [B, L]`, `duration [B]`
-> `x_seg`, `x_est`, `maskT`; segmenter `x_seg`, `language`,
`known_boundaries`, `prev_boundaries`, `t`, `maskT`, `threshold`, `radius`
-> `boundaries`; estimator `x_est`, `boundaries`, `maskT`, `maskN`,
`threshold` -> `presence`, `scores`.

### Parity test

`tests/test_game_parity.py` (marker `parity`) runs only when the weights are
present. It runs GAME's official `infer.py extract --batch-size 1` (PyTorch
checkpoint, from a checkout of openvpi/GAME at tag v1.0.3 and its own
environment) and our ONNX loop on the same input, a synthesized sung-like
melody (or `GAME_FIXTURE`), then compares: note count within 10%, 90% of the
official notes matched one-to-one by onset and offset within 50 ms, and
pitches within half a semitone. D3PM sampling is stochastic on both sides
(GAME's boundary removal is unseeded), hence the tolerance. The environment variables it reads are listed in the module
docstring. Its second test checks our slicer cuts exactly like GAME's
`slicer2.py` (needs only `GAME_REPO`).

## Pitch curve (RMVPE)

`note_detector/rmvpe.py` computes the Pitch curve of the separated vocals;
`__main__.py` wires it as the `pitch_curve` step. The pure maths (mel
filterbank, chunk plan, salience decoding) is in `rmvpe_math.py`, covered at
100%. `rmvpe.py` is model glue, omitted from coverage.

- **Model:** RMVPE, run in fp32 on CUDA (CPU if there is none), loaded once per
  worker process (`load_rmvpe` is cached).
- **Code:** the network classes are vendored in `note_detector/vendor/rmvpe/`
  (Apache-2.0, `LICENSE` and `NOTICE` kept; source and commit in the notice).
  The checkpoint uses `DeepUnet0`, so the unused timbre filter it builds is
  deleted to keep the weights load strict. `vendor/` is excluded from Ruff
  and from coverage; do not restyle it.
- **Weights:** the RVC project's `rmvpe.pt` (MIT, 181 MB), pinned to a commit
  of `lj1995/VoiceConversionWebUI` on Hugging Face and verified by sha256
  (`6d62215f...c193`) by `weights.py`, driven by `rmvpe-weights.json`, in a
  Dockerfile `RUN`. They live at
  `/app/weights/rmvpe.pt`. To change the model, change the URL and the
  checksum in the manifest together.
- **Parameters:** audio mixed to mono and resampled to 16 kHz; centered STFT
  with 1024 window and 160-sample hop (10 ms), 128 HTK mel bins from 30 Hz to
  8 kHz, log with a 1e-5 floor. The salience (360 bins, 20 cents apart) is
  decoded by the weighted mean of the 9 bins around the peak. **Voicing
  threshold 0.03**, raw: a frame whose peak is at or below it is unvoiced
  (`0`), and the Vocal notes never mask it. Frame `i` is centered at
  `i x 10 ms`, so the curve starts at t = 0 and has `samples // 160 + 1`
  frames; the output is checked against that count. The whole spectrogram is
  run in a single pass, as RVC does (the GRU reads the full context; about
  30k frames for a 5-minute Track fit on the GPU). Vocals shorter than 512
  samples are too short for the centered STFT and fail the job. The model is
  loaded in `main()`, before the first job.
- **Check:** `tests/test_rmvpe_weights.py` (marker `rmvpe`) runs the real
  model on a synthetic sung tone with vibrato and on a vowel-like phrase and
  asserts a median error under 6 cents and a 95th percentile under 15 (so
  octave errors on a few frames cannot hide). It skips unless the model
  stack is installed and the weights exist (`RMVPE_WEIGHTS`, default
  `/app/weights/rmvpe.pt`): `RMVPE_WEIGHTS=... uv run pytest -m rmvpe`.

## Commands (from `apps/note-detector`, or `nub run <task> --filter=note-detector`)

```sh
uv sync                      # dependencies of the dev group (tests and lint)
uv sync --group model        # plus the model stack (Linux, with the GPU wheels)
uv run --locked pytest       # unit tests (no models needed)
uv run --locked pytest --cov # + coverage report, fails below 100%
uv run --locked ruff check . && uv run --locked ruff format --check .
```

`--locked` makes a stale `uv.lock` fail the run instead of silently
re-resolving. Regenerate the lock with `uv lock` after changing dependencies.

Python is pinned in `.python-version` (3.12).

## Dependencies

- PyTorch and ONNX Runtime use CUDA 13 / cuDNN 9 builds from PyPI. Keep
  their CUDA major versions aligned; importing torch before ONNX Runtime
  loads the GPU libraries both adapters share.
- The base image supplies CUDA 13.4.3; the Python wheels supply their own
  CUDA 13.0 libraries. A base-image update alone does not update those wheels.
- `check_gpu_stack.py` runs during the image build, before weight downloads.
  It rejects CPU/CUDA 12 builds and loads the wheel-provided CUDA/cuDNN
  libraries. Linking the ONNX provider itself also needs the host driver,
  so that check belongs in the GPU smoke test.

## Publishing

`.github/workflows/note-detector-image.yml` builds the image from this
directory (`Dockerfile`, linux/amd64, CUDA 13.4.3 base) on every pull request
that touches it, and publishes it to GHCR on a push to `main`:

- `ghcr.io/theryston/vozzify/note-detector:latest` moves with `main`;
- `…:sha-<short>` is immutable.

The workflow passes the commit as the `GIT_SHA` build arg. RunPod serverless
endpoints pull the image by tag, so pin an endpoint to a `sha-` tag when a
release must not move. The weights (about 1.3 GB) are downloaded at build
time and verified against pinned sha256 checksums; clean caches in the same
layer, as the existing steps do, because the hosted runner's disk is the limit.

## Image smoke test and GPU targets

The production entrypoint is `python -m note_detector`. It loads the GAME,
Mel-Band RoFormer and RMVPE models once before RunPod starts, then reuses
those instances for each job. The CUDA 13 wheels support
Ampere (including A40 / RTX A6000) and Blackwell GPUs. Configure the RunPod
endpoint's CUDA version selection for hosts compatible with the base image's
CUDA 13.4 requirement; the console's generic "12.8+" GPU notice alone does
not establish this compatibility. Both startup and the smoke command fail
promptly when CUDA is unavailable.

Build the image from this directory with the commit sha that should be
reported by completed jobs, then run one short synthetic job through the
real download, separation, note detection, Pitch curve and presigned upload
steps:

```sh
docker build --build-arg GIT_SHA="$(git -C ../.. rev-parse HEAD)" -t note-detector:smoke .
docker run --rm --gpus all note-detector:smoke python smoke_test.py
```

The command prints the returned `detectorVersion`, notes count, uploaded byte
counts and progress stages. It uses an in-container HTTP server as the music
URL and the two presigned PUT URLs, so it needs no API, credentials or
external storage. On a machine without a GPU, run the same container command
without `--gpus all`; it should exit before loading model weights with
`note-detector requires a CUDA GPU`.

Before switching a RunPod endpoint, run the GPU smoke test on the target host
and confirm GAME sessions use `CUDAExecutionProvider` rather than falling back
to CPU. The CI build checks wheel libraries and no-GPU failure only; it does
not prove GPU inference or model parity. Roll back by pinning the endpoint to
its previous `sha-` image tag; job input/output and model weights are unchanged.
