"""Bound GAME's attention tensors while retaining context at artificial cuts."""

from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass

from note_detector.game_slicer import Clip
from note_detector.notes import Note

MAX_SECONDS = 20
OVERLAP_SECONDS = 2
# Only artificial splits of a sustained note may join, within half a semitone.
JOIN_PITCH_DISTANCE = 0.5


@dataclass(frozen=True)
class _Window:
    clip: Clip
    start: float
    end: float


def _windows(clip: Clip, sample_rate: int) -> Iterator[_Window]:
    maximum = MAX_SECONDS * sample_rate
    overlap = OVERLAP_SECONDS * sample_rate
    total = len(clip.waveform)
    begin = 0
    while True:
        end = min(begin + maximum, total)
        # Each overlap belongs to its neighbours in halves, with no gap.
        owned_start = begin + overlap // 2 if begin else 0
        owned_end = end - overlap // 2 if end < total else total
        yield _Window(
            Clip(clip.offset + begin / sample_rate, clip.waveform[begin:end]),
            clip.offset + owned_start / sample_rate,
            clip.offset + owned_end / sample_rate,
        )
        if end == total:
            return
        begin = end - overlap


def _append_notes(
    combined: list[Note],
    notes: Sequence[Note],
    window: _Window,
    previous_crosses: bool,
) -> bool:
    crosses_right = False
    for note in notes:
        start = max(note.start, window.start)
        end = min(note.end, window.end)
        if end <= start:
            continue
        if (
            previous_crosses
            and combined
            and note.start < window.start
            and combined[-1].end == start
            and abs(combined[-1].pitch - note.pitch) <= JOIN_PITCH_DISTANCE
        ):
            # Retain the earlier estimate rather than introducing a new pitch.
            previous = combined.pop()
            combined.append(Note(previous.pitch, previous.start, end))
        else:
            combined.append(Note(note.pitch, start, end))
        previous_crosses = False
        crosses_right = note.end > window.end
    return crosses_right


def bounded_clip_notes(
    clip: Clip,
    sample_rate: int,
    detect: Callable[[Clip], list[Note]],
) -> list[Note]:
    """Decode sequential windows, reconciling only notes crossing their seam.

    Silence-separated clips are never joined. Repeated notes at a seam stay
    separate unless both predictions place the seam inside the same pitch.
    """
    combined: list[Note] = []
    crosses = False
    for window in _windows(clip, sample_rate):
        crosses = _append_notes(combined, detect(window.clip), window, crosses)
    return combined
