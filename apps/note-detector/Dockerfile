# The RunPod serverless image. Built from this directory as the context (see
# .dockerignore), published to GHCR by .github/workflows/note-detector-image.yml.
#
# CUDA 13.4.3 requires a compatible RunPod host driver. The torch CUDA 13 and
# onnxruntime-gpu CUDA 13 builds share the wheel-provided libraries below.
# GPU libraries (cuBLAS, cuDNN, ...) come bundled in the PyPI wheels pinned in
# pyproject.toml, so the `base` flavor is enough: it supplies the NVIDIA driver
# interface and the minimal system libraries. The `runtime` flavor adds CUDA
# libraries that the wheels already carry, and it is bigger on disk, which the
# image build can't spare on a hosted runner. Python 3.12 is installed by uv
# from .python-version.
FROM nvidia/cuda:13.4.3-base-ubuntu22.04

COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv

ENV UV_PYTHON_INSTALL_DIR=/opt/python \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1

WORKDIR /app

# The dependencies come first, so a change to the code does not reinstall
# the CUDA stack. `--locked` fails the build when uv.lock is out of date.
# uv hard-links the venv from its cache (the default), so the packages are
# stored once; the cache is then removed in the same step, so it never stays
# in an image layer. The GitHub-hosted runner runs out of disk without this.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev --group model && uv cache clean

# Check the installed CUDA builds and provider linkage without a GPU, before
# downloading weights. A successful CPU-only import cannot prove this linkage.
COPY check_gpu_stack.py ./check_gpu_stack.py
RUN python check_gpu_stack.py

# The model weights are downloaded here, pinned by sha256 (see CLAUDE.md).

# Mel-Band RoFormer "Kim" vocals weights and their published config, pinned by
# sha256 in separation-weights.json (the build fails on a mismatch).
COPY separation-weights.json /tmp/separation/separation-weights.json
COPY note_detector/weights.py /tmp/separation/weights.py
RUN python /tmp/separation/weights.py \
      /tmp/separation/separation-weights.json /app/weights/mel-band-roformer \
    && rm -rf /tmp/separation

# GAME medium, from its official ONNX release (one zip). weights.py only needs
# the standard library, so it runs before the code is copied, and the build
# fails if the zip's sha256 differs from the one pinned in game-weights.json.
# Only the files the worker uses are kept (not dur2bd/bd2dur); the zip and
# the unpacked copy are removed in the same layer.
COPY game-weights.json /tmp/game/game-weights.json
COPY note_detector/weights.py /tmp/game/weights.py
RUN python /tmp/game/weights.py /tmp/game/game-weights.json /tmp/game/download \
    && python -m zipfile -e /tmp/game/download/GAME-1.0.3-medium-onnx.zip \
      /tmp/game/unpacked \
    && mkdir -p /app/weights/game-medium \
    && cd /tmp/game/unpacked/GAME-1.0.3-medium-onnx \
    && mv config.json encoder.onnx segmenter.onnx estimator.onnx \
      /app/weights/game-medium/ \
    && rm -rf /tmp/game

# RMVPE (Pitch curve): the RVC project's checkpoint (MIT), pinned to a commit
# of its Hugging Face repo in rmvpe-weights.json with its sha256; weights.py
# fails the build on a mismatch.
COPY rmvpe-weights.json /tmp/rmvpe/rmvpe-weights.json
COPY note_detector/weights.py /tmp/rmvpe/weights.py
RUN python /tmp/rmvpe/weights.py /tmp/rmvpe/rmvpe-weights.json /app/weights \
    && rm -rf /tmp/rmvpe

COPY note_detector ./note_detector
COPY smoke_test.py ./smoke_test.py

# The git sha of the build, reported as `note-detector@<sha>` in every job
# output. Declared after the dependency layer so a new commit does not
# reinstall the CUDA stack.
ARG GIT_SHA=unknown
ENV NOTE_DETECTOR_GIT_SHA=$GIT_SHA

CMD ["python", "-u", "-m", "note_detector"]
