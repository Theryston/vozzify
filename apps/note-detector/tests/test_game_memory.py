"""Long uninterrupted vocals must never reach GAME as one large tensor."""

import numpy as np
import pytest

from note_detector.game_pipeline import Encoded, notes_in_waveform


class BoundedGame:
    sample_rate = 1000
    timestep = 0.01

    def __init__(self):
        self.durations = []

    def encode(self, waveform, duration):
        assert duration <= 20, "An unbounded clip can exhaust GAME's memory"
        assert len(waveform) == round(duration * self.sample_rate)
        self.durations.append(duration)
        mask = np.ones((1, round(duration / self.timestep)), dtype=bool)
        features = np.zeros((1, mask.shape[1], 1), dtype=np.float32)
        return Encoded(features, features, mask)

    def segment(self, encoded, known, previous, t):
        return np.zeros_like(known)

    def estimate(self, encoded, boundaries):
        return np.array([True]), np.array([60.2])


@pytest.mark.parametrize("seconds", [20, 20.01, 38, 41, 120])
def test_long_vocals_are_bounded_without_splitting_a_sustained_note(seconds):
    game = BoundedGame()
    waveform = np.full(round(seconds * game.sample_rate), 0.5, np.float32)

    notes = notes_in_waveform(waveform, game)

    assert len(notes) == 1
    assert notes[0].pitch == 60.2
    assert notes[0].start == 0
    assert notes[0].end == pytest.approx(seconds)
    assert max(game.durations) <= 20
    assert len(game.durations) == max(1, int(np.ceil((seconds - 2) / 18)))


def test_bounded_clips_keep_their_offsets_after_silence():
    game = BoundedGame()
    voiced = np.full(41 * game.sample_rate, 0.5, np.float32)
    silence = np.zeros(game.sample_rate, np.float32)

    notes = notes_in_waveform(np.concatenate([voiced, silence, voiced]), game)

    assert len(notes) == 2
    assert notes[0].start == 0
    assert notes[0].end == pytest.approx(41, abs=0.1)
    assert 41.8 <= notes[1].start <= 42
    assert notes[1].end == 83
    assert len(game.durations) == 6
