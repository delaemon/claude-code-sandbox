"""Single-person bounding-box detector for the top-down pose pipeline.

Uses torchvision's COCO-pretrained Faster R-CNN (MobileNetV3-Large FPN,
320x320) to find the "person" class box. This is only the localization
stage -- PoseModel (see pose_model.py) does the actual keypoint estimation
on the resulting crop.
"""

from typing import Optional, Tuple

import numpy as np
import torch
from torchvision.models.detection import (
    FasterRCNN_MobileNet_V3_Large_320_FPN_Weights,
    fasterrcnn_mobilenet_v3_large_320_fpn,
)

from .pretrained import build_with_pretrained_fallback

Box = Tuple[float, float, float, float]  # (x1, y1, x2, y2)

_PERSON_LABEL = 1  # COCO category index for "person" in torchvision's detection models


class PersonDetector:
    def __init__(self, device: str = "cpu", score_thresh: float = 0.5, pretrained: bool = True):
        weights = FasterRCNN_MobileNet_V3_Large_320_FPN_Weights.COCO_V1 if pretrained else None
        # weights_backbone also defaults to a pretrained (downloadable) checkpoint; it must
        # be disabled explicitly in the fallback too, or that would also try to fetch it.
        self.model = build_with_pretrained_fallback(
            fasterrcnn_mobilenet_v3_large_320_fpn,
            weights,
            description="Faster R-CNN person detector",
            weights_backbone=None,
        )
        self.model.eval().to(device)
        self.device = device
        self.score_thresh = score_thresh

    @torch.no_grad()
    def detect(self, frame_rgb: np.ndarray) -> Optional[Box]:
        """frame_rgb: HxWx3 uint8 RGB frame. Returns the largest confident
        person box, or None if nobody was detected above score_thresh.
        """
        tensor = torch.from_numpy(frame_rgb).permute(2, 0, 1).float() / 255.0
        tensor = tensor.to(self.device)

        output = self.model([tensor])[0]
        boxes, labels, scores = output["boxes"], output["labels"], output["scores"]

        keep = (labels == _PERSON_LABEL) & (scores >= self.score_thresh)
        if not bool(keep.any()):
            return None

        person_boxes = boxes[keep]
        areas = (person_boxes[:, 2] - person_boxes[:, 0]) * (person_boxes[:, 3] - person_boxes[:, 1])
        best = person_boxes[areas.argmax()].cpu().tolist()
        return tuple(best)


def expand_box(box: Box, frame_width: int, frame_height: int, scale: float = 1.25) -> Box:
    """Pad a tight detection box by `scale` (standard top-down pose practice
    so joints near the box edge -- e.g. raised hands at the top of a golf
    backswing -- aren't clipped), clamped to the frame bounds.
    """
    x1, y1, x2, y2 = box
    cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    w, h = (x2 - x1) * scale, (y2 - y1) * scale
    return (
        max(0.0, cx - w / 2.0),
        max(0.0, cy - h / 2.0),
        min(float(frame_width), cx + w / 2.0),
        min(float(frame_height), cy + h / 2.0),
    )
