"""Video reading/writing helpers, with iPhone rotation-metadata handling.

iPhone videos (.mov/.mp4) store sensor orientation as a rotation matrix in
the track header rather than physically rotating pixels. OpenCV >= 4.5 with
an FFmpeg backend auto-applies this when `CAP_PROP_ORIENTATION_AUTO` is
enabled; we turn that on explicitly since it defaults to off in some
builds. If a specific build still ignores the metadata, `infer.py` exposes
a `--rotate` override (see `rotate_frame` below) as a manual escape hatch.
"""

from typing import Iterator, List, Optional

import cv2
import numpy as np


class VideoReader:
    def __init__(self, path: str):
        self.cap = cv2.VideoCapture(path)
        if not self.cap.isOpened():
            raise IOError(f"Could not open video: {path}")
        try:
            self.cap.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)
        except cv2.error:
            pass  # older OpenCV builds don't expose this property; ignore

        self.fps = self.cap.get(cv2.CAP_PROP_FPS) or 30.0
        self.width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.frame_count = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))

    def __iter__(self) -> Iterator[np.ndarray]:
        while True:
            ok, frame_bgr = self.cap.read()
            if not ok:
                break
            yield cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

    def release(self):
        self.cap.release()


def rotate_frame(frame_rgb: np.ndarray, degrees: int) -> np.ndarray:
    """Manual rotation override for builds that don't honor orientation metadata."""
    if degrees % 360 == 0:
        return frame_rgb
    if degrees % 360 == 90:
        return cv2.rotate(frame_rgb, cv2.ROTATE_90_CLOCKWISE)
    if degrees % 360 == 180:
        return cv2.rotate(frame_rgb, cv2.ROTATE_180)
    if degrees % 360 == 270:
        return cv2.rotate(frame_rgb, cv2.ROTATE_90_COUNTERCLOCKWISE)
    raise ValueError(f"Unsupported rotation angle: {degrees}")


def read_all_frames_rgb(path: str, rotate: Optional[int] = None) -> List[np.ndarray]:
    reader = VideoReader(path)
    frames = [rotate_frame(f, rotate) if rotate else f for f in reader]
    reader.release()
    return frames


class VideoWriter:
    def __init__(self, path: str, fps: float, width: int, height: int):
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        self.writer = cv2.VideoWriter(path, fourcc, fps, (width, height))
        if not self.writer.isOpened():
            raise IOError(f"Could not open video writer for: {path}")

    def write(self, frame_rgb: np.ndarray):
        self.writer.write(cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR))

    def release(self):
        self.writer.release()
