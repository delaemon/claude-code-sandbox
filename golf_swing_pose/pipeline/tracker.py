"""Lightweight bbox tracking so the (comparatively expensive) person
detector doesn't need to run on every single frame of the clip.
"""

from typing import Optional, Tuple

Box = Tuple[float, float, float, float]


class BoxTracker:
    def __init__(self, smoothing: float = 0.6):
        self.smoothing = smoothing
        self.box: Optional[Box] = None

    def update(self, detected_box: Optional[Box]) -> Optional[Box]:
        """Feed in this frame's detection (or None if skipped/not found).
        Returns the tracked box: an EMA of recent detections, or the last
        known box carried forward if this frame had no detection.
        """
        if detected_box is None:
            return self.box
        if self.box is None:
            self.box = detected_box
        else:
            a = self.smoothing
            self.box = tuple(a * prev + (1 - a) * new for prev, new in zip(self.box, detected_box))
        return self.box


def should_redetect(frame_idx: int, detect_every_n: int, has_box: bool) -> bool:
    return (not has_box) or (frame_idx % detect_every_n == 0)
