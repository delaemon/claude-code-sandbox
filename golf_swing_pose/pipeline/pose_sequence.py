"""Shared per-frame detect -> crop -> pose-estimate pipeline.

Used by both infer.py and data/golfdb_dataset.py so the SwingEventModel is
trained on the same kind of per-frame feature (a person-crop, not a raw
resized full frame) that it sees at inference time -- training on one
distribution and predicting on another would silently degrade accuracy.
"""

from typing import List, Optional, Tuple

import cv2
import numpy as np
import torch

from data.transforms import (
    affine_transform_points,
    box_to_center_size,
    get_affine_transform,
    invert_affine_transform,
    normalize_crop,
)
from models.detector import PersonDetector, expand_box
from models.pose_model import PoseModel
from pipeline.tracker import BoxTracker, should_redetect

Box = Tuple[float, float, float, float]


def extract_pose_sequence(
    frames: List[np.ndarray],
    pose_model: PoseModel,
    detector: PersonDetector,
    device: str = "cpu",
    detect_every_n: int = 5,
):
    """Runs person detection/tracking + SimCC pose inference over a list of
    RGB frames. Returns (xs, ys, scores, boxes, pooled_feats): per-frame
    lists of (K,) keypoint arrays in original-frame pixel coordinates,
    (K,) confidences, the tracked bbox (or None), and the backbone's
    pooled feature vector for that frame (reused by the swing-event model).

    Frames before the first successful detection have no crop to run the
    pose model on; their pooled feature is backfilled from the first
    successfully-detected frame instead of an all-zero vector, since an
    all-zero feature is out-of-distribution for a backbone that never
    produces one for a real image and would corrupt the event model's
    recurrent state.
    """
    if not frames:
        return [], [], [], [], []

    input_h, input_w = pose_model.input_size
    aspect_ratio = input_w / input_h
    box_tracker = BoxTracker()
    num_keypoints = len(pose_model.keypoint_names)

    xs, ys, scores, boxes, pooled_feats = [], [], [], [], []

    for frame_idx, frame in enumerate(frames):
        if should_redetect(frame_idx, detect_every_n, box_tracker.box is not None):
            detected = detector.detect(frame)
        else:
            detected = None
        box: Optional[Box] = box_tracker.update(detected)

        if box is None:
            xs.append(np.zeros(num_keypoints, dtype=np.float32))
            ys.append(np.zeros(num_keypoints, dtype=np.float32))
            scores.append(np.zeros(num_keypoints, dtype=np.float32))
            boxes.append(None)
            pooled_feats.append(None)  # backfilled below
            continue

        padded_box = expand_box(box, frame.shape[1], frame.shape[0])
        center, size = box_to_center_size(padded_box, aspect_ratio=aspect_ratio, padding=1.0)
        trans = get_affine_transform(center, size, (input_w, input_h))
        crop = cv2.warpAffine(frame, trans, (input_w, input_h), flags=cv2.INTER_LINEAR)
        tensor = normalize_crop(crop).unsqueeze(0).to(device)

        x_px, y_px, conf, pooled = pose_model.predict(tensor)
        x_px = x_px.squeeze(0).cpu().numpy()
        y_px = y_px.squeeze(0).cpu().numpy()
        conf = conf.squeeze(0).cpu().numpy()

        inv_trans = invert_affine_transform(trans)
        xy_frame = affine_transform_points(np.stack([x_px, y_px], axis=1), inv_trans)

        xs.append(xy_frame[:, 0].astype(np.float32))
        ys.append(xy_frame[:, 1].astype(np.float32))
        scores.append(conf)
        boxes.append(padded_box)
        pooled_feats.append(pooled.squeeze(0).cpu())

    first_valid = next((i for i, b in enumerate(boxes) if b is not None), None)
    if first_valid is None:
        pooled_feats = [torch.zeros(pose_model.backbone.out_channels) for _ in frames]
    else:
        for i in range(first_valid):
            pooled_feats[i] = pooled_feats[first_valid]

    return xs, ys, scores, boxes, pooled_feats
