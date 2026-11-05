import numpy as np
import pytest

from note_detector.game_slicer import Clip
from note_detector.game_windows import bounded_clip_notes
from note_detector.notes import Note


@pytest.mark.parametrize("sample_rate", [44100, 22050, 1000, 441])
def test_windows_keep_audio_context_offsets_and_the_unpadded_tail(sample_rate):
    waveform = np.arange(41 * sample_rate, dtype=np.float32)
    clips = []

    def detect(clip):
        clips.append(clip)
        return []

    assert bounded_clip_notes(Clip(7, waveform), sample_rate, detect) == []

    assert [clip.offset for clip in clips] == [7, 25, 43]
    assert [len(clip.waveform) for clip in clips] == [
        20 * sample_rate,
        20 * sample_rate,
        5 * sample_rate,
    ]
    for clip, begin in zip(clips, [0, 18, 36], strict=True):
        np.testing.assert_array_equal(
            clip.waveform,
            waveform[begin * sample_rate : (begin + 20) * sample_rate],
        )
        assert np.shares_memory(clip.waveform, waveform)


@pytest.mark.parametrize(
    ("first", "second", "expected"),
    [
        # Same sustained note with slightly different estimates.
        ([Note(60, 0, 20)], [Note(60.3, 18, 21)], [Note(60, 0, 21)]),
        ([Note(60, 0, 20)], [Note(60.5, 18, 21)], [Note(60, 0, 21)]),
        # A different pitch on either side of the ownership boundary.
        (
            [Note(60, 0, 20)],
            [Note(61, 18, 21)],
            [Note(60, 0, 19), Note(61, 19, 21)],
        ),
        # Repeated notes whose real boundary coincides with the seam.
        (
            [Note(60, 0, 19), Note(60, 19, 20)],
            [Note(60, 18, 19), Note(60, 19, 21)],
            [Note(60, 0, 19), Note(60, 19, 21)],
        ),
        # Onsets just before and after the seam must survive.
        (
            [Note(60, 0, 18.5), Note(60, 18.5, 20)],
            [Note(60, 18, 18.5), Note(60, 18.5, 21)],
            [Note(60, 0, 18.5), Note(60, 18.5, 21)],
        ),
        (
            [Note(60, 0, 19.5), Note(60, 19.5, 20)],
            [Note(60, 18, 19.5), Note(60, 19.5, 21)],
            [Note(60, 0, 19.5), Note(60, 19.5, 21)],
        ),
        # A gap or a boundary observed by only one window prevents a join.
        (
            [Note(60, 0, 18.8)],
            [Note(60, 19.2, 21)],
            [Note(60, 0, 18.8), Note(60, 19.2, 21)],
        ),
        (
            [Note(60, 0, 20)],
            [Note(60, 19, 21)],
            [Note(60, 0, 19), Note(60, 19, 21)],
        ),
        (
            [Note(60, 0, 19)],
            [Note(60, 18, 21)],
            [Note(60, 0, 19), Note(60, 19, 21)],
        ),
        # Context from an adjacent window cannot fill its unvoiced owner.
        ([Note(60, 0, 20)], [], [Note(60, 0, 19)]),
        ([], [Note(60, 18, 21)], [Note(60, 19, 21)]),
    ],
)
def test_overlap_has_one_owner_and_only_sustained_notes_join(
    first, second, expected
):
    predictions = iter([first, second])
    waveform = np.ones(21000, dtype=np.float32)

    notes = bounded_clip_notes(
        Clip(0, waveform), 1000, lambda _: next(predictions)
    )

    assert notes == expected


@pytest.mark.parametrize("samples", [0, 1, 19999, 20000])
def test_short_clips_are_not_subdivided(samples):
    waveform = np.ones(samples, dtype=np.float32)
    calls = []
    expected = [Note(62.2, 3, 3 + samples / 1000)] if samples else []

    def detect(clip):
        calls.append(clip)
        return expected

    assert bounded_clip_notes(Clip(3, waveform), 1000, detect) == expected
    assert len(calls) == 1
    assert calls[0].offset == 3
    np.testing.assert_array_equal(calls[0].waveform, waveform)


def test_silent_middle_window_does_not_join_separate_phrases():
    predictions = iter([[Note(60, 0, 20)], [], [Note(60, 36, 41)]])

    notes = bounded_clip_notes(
        Clip(0, np.ones(41000, np.float32)), 1000, lambda _: next(predictions)
    )

    assert notes == [Note(60, 0, 19), Note(60, 37, 41)]
