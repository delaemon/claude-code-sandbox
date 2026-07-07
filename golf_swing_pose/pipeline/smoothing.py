"""One-Euro Filter (Casiez, Roussel & Vogel, CHI 2012) for temporal
smoothing of keypoint coordinates -- standard practice in real-time pose
pipelines (including MediaPipe's own landmark smoothing) to remove
per-frame jitter without adding much lag.
"""

import math
from typing import List, Optional

import numpy as np


class OneEuroFilter:
    def __init__(self, freq: float, min_cutoff: float = 1.0, beta: float = 0.0, d_cutoff: float = 1.0):
        self.freq = freq
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self.x_prev: Optional[float] = None
        self.dx_prev = 0.0

    def _alpha(self, cutoff: float) -> float:
        tau = 1.0 / (2 * math.pi * cutoff)
        te = 1.0 / self.freq
        return 1.0 / (1.0 + tau / te)

    def __call__(self, x: float) -> float:
        if self.x_prev is None:
            self.x_prev = x
            return x

        dx = (x - self.x_prev) * self.freq
        a_d = self._alpha(self.d_cutoff)
        dx_hat = a_d * dx + (1 - a_d) * self.dx_prev

        cutoff = self.min_cutoff + self.beta * abs(dx_hat)
        a = self._alpha(cutoff)
        x_hat = a * x + (1 - a) * self.x_prev

        self.x_prev, self.dx_prev = x_hat, dx_hat
        return x_hat


class KeypointSmoother:
    """Runs one OneEuroFilter per (keypoint, axis) over a video's keypoint sequence."""

    def __init__(self, num_keypoints: int, fps: float, min_cutoff: float = 1.0, beta: float = 0.3):
        self.filters_x: List[OneEuroFilter] = [OneEuroFilter(fps, min_cutoff, beta) for _ in range(num_keypoints)]
        self.filters_y: List[OneEuroFilter] = [OneEuroFilter(fps, min_cutoff, beta) for _ in range(num_keypoints)]

    def smooth(self, xs: np.ndarray, ys: np.ndarray):
        """xs, ys: (K,) coordinates for one frame -> smoothed (K,), (K,)."""
        sx = np.array([f(v) for f, v in zip(self.filters_x, xs)], dtype=np.float32)
        sy = np.array([f(v) for f, v in zip(self.filters_y, ys)], dtype=np.float32)
        return sx, sy
