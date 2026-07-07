"""Drawing helpers for the annotated output video."""

from typing import List, Sequence, Tuple

import cv2
import numpy as np


def draw_skeleton(
    frame_rgb: np.ndarray,
    xs: Sequence[float],
    ys: Sequence[float],
    scores: Sequence[float],
    edges: List[Tuple[int, int]],
    score_thresh: float = 0.3,
    point_color: Tuple[int, int, int] = (0, 255, 0),
    line_color: Tuple[int, int, int] = (255, 80, 0),
) -> np.ndarray:
    frame = frame_rgb.copy()
    for i, j in edges:
        if scores[i] > score_thresh and scores[j] > score_thresh:
            pt1 = (int(round(xs[i])), int(round(ys[i])))
            pt2 = (int(round(xs[j])), int(round(ys[j])))
            cv2.line(frame, pt1, pt2, line_color, 2, cv2.LINE_AA)

    for x, y, s in zip(xs, ys, scores):
        if s > score_thresh:
            cv2.circle(frame, (int(round(x)), int(round(y))), 3, point_color, -1, cv2.LINE_AA)

    return frame


def draw_event_label(frame_rgb: np.ndarray, text: str) -> np.ndarray:
    frame = frame_rgb.copy()
    cv2.putText(frame, text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 2, cv2.LINE_AA)
    return frame
