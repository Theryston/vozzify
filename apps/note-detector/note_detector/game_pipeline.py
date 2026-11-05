"""GAME's inference loop over its three ONNX modules, reproduced.

For each bounded window of a silence-sliced clip, it runs the encoder, the
segmenter's D3PM sampling and the estimator, then decodes voiced regions. The
modules themselves sit behind `GameModules`, so this logic is tested with
fakes; `game.py` is the onnxruntime adapter.
"""

from dataclasses import dataclass
from typing import Protocol

import numpy as np

from note_detector.game_decode import (
    RegionScores,
    clip_notes,
    combine_notes,
    d3pm_times,
    region_durations,
    sample_boundaries,
)
from note_detector.game_slicer import Clip, slice_vocals
from note_detector.game_windows import bounded_clip_notes
from note_detector.notes import Note


@dataclass(frozen=True)
class Encoded:
    x_seg: np.ndarray
    x_est: np.ndarray
    # bool [1, frames]: the frames that hold audio.
    mask: np.ndarray


class GameModules(Protocol):
    sample_rate: int
    # Seconds per frame.
    timestep: float

    def encode(self, waveform: np.ndarray, duration: float) -> Encoded: ...

    def segment(
        self,
        encoded: Encoded,
        known: np.ndarray,
        previous: np.ndarray,
        t: float,
    ) -> np.ndarray:
        """One pass of the segmenter: bool [1, frames] boundaries."""
        ...

    def estimate(
        self, encoded: Encoded, boundaries: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        """(presence, MIDI pitch) of each region, both [regions]."""
        ...


def _clip_scores(
    clip: Clip, modules: GameModules
) -> tuple[RegionScores, float]:
    length = clip.waveform.shape[0] / modules.sample_rate
    encoded = modules.encode(clip.waveform, length)
    # The whole clip is one known region, so no boundary is known up front.
    known = np.zeros_like(encoded.mask)
    boundaries = sample_boundaries(
        lambda previous, t: modules.segment(encoded, known, previous, t),
        known,
        d3pm_times(),
    )
    presence, pitches = modules.estimate(encoded, boundaries)
    durations = region_durations(
        boundaries[0], encoded.mask[0], modules.timestep
    )
    return RegionScores(durations, presence, pitches), length


def _notes_in_clip(clip: Clip, modules: GameModules) -> list[Note]:
    scores, length = _clip_scores(clip, modules)
    return clip_notes(scores, clip.offset, length)


def notes_in_waveform(waveform: np.ndarray, modules: GameModules) -> list[Note]:
    """The Vocal notes of mono vocals at the modules' sample rate."""
    notes: list[Note] = []
    for clip in slice_vocals(waveform, modules.sample_rate):
        notes += bounded_clip_notes(
            clip,
            modules.sample_rate,
            lambda part: _notes_in_clip(part, modules),
        )
    return combine_notes(notes)
