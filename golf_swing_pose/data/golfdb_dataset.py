"""GolfDB-style event dataset for training the SwingEventModel (train_events.py).

GolfDB (McNally et al., CVPRW 2019, https://github.com/wmcnally/golfdb)
ships per-swing video clips together with 8 event frame indices (address,
toe-up, mid-backswing, top, mid-downswing, impact, follow-through, finish).
Rather than depend on GolfDB's specific pickle format and youtube-download
pipeline, this loader expects a simpler generic JSON manifest so it also
works with self-recorded/annotated clips:

    [
      {"video": "clip_0001.mp4", "events": [12, 34, 45, 52, 58, 63, 70, 90]},
      ...
    ]

`events` must have exactly len(event_names) frame indices, in the same
temporal order as `configs/events.yaml:events`. Each clip is assumed to
already be a single-swing, single-golfer video (as in GolfDB) -- this
loader does not run person detection, it simply resizes each full frame to
the pose model's input size before extracting features.
"""

import json
import os
from typing import List

import cv2
import torch
from torch.utils.data import Dataset

from ..pipeline.video_io import read_all_frames_rgb
from .transforms import normalize_crop


class GolfDBEventDataset(Dataset):
    def __init__(self, videos_dir: str, annotation_file: str, pose_model, event_names: List[str], device: str = "cpu"):
        with open(annotation_file, "r") as f:
            self.samples = json.load(f)
        self.videos_dir = videos_dir
        self.pose_model = pose_model
        self.event_names = event_names
        self.device = device

    def __len__(self) -> int:
        return len(self.samples)

    @torch.no_grad()
    def __getitem__(self, idx: int):
        sample = self.samples[idx]
        frames = read_all_frames_rgb(os.path.join(self.videos_dir, sample["video"]))
        input_h, input_w = self.pose_model.input_size

        feats = []
        for frame in frames:
            crop = cv2.resize(frame, (input_w, input_h))
            tensor = normalize_crop(crop).unsqueeze(0).to(self.device)
            _, _, _, pooled = self.pose_model.predict(tensor)
            feats.append(pooled.squeeze(0).cpu())
        feats = torch.stack(feats, dim=0)  # (T, C)

        none_class = len(self.event_names)
        labels = torch.full((len(frames),), fill_value=none_class, dtype=torch.long)
        for class_idx, frame_idx in enumerate(sample["events"]):
            if 0 <= frame_idx < len(frames):
                labels[frame_idx] = class_idx

        return {"features": feats, "labels": labels}
