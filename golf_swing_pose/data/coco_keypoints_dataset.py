"""COCO-format keypoints dataset for training PoseModel (train_pose.py).

Expects the standard COCO "person_keypoints_*.json" annotation format:
https://cocodataset.org/#format-data (17 keypoints, COCO order -- the same
order as `configs/pose.yaml:keypoints`).
"""

import json
import os
from typing import List, Tuple

import cv2
import numpy as np
import torch
from torch.utils.data import Dataset

from .transforms import (
    affine_transform_points,
    box_to_center_size,
    encode_simcc_label,
    get_affine_transform,
    normalize_crop,
)


class CocoKeypointsDataset(Dataset):
    def __init__(
        self,
        images_dir: str,
        annotation_file: str,
        keypoint_names: List[str],
        input_size: Tuple[int, int] = (256, 192),
        split_ratio: float = 2.0,
        sigma: float = 2.0,
    ):
        with open(annotation_file, "r") as f:
            data = json.load(f)

        self.images_dir = images_dir
        self.input_size = input_size  # (H, W)
        self.split_ratio = split_ratio
        self.sigma = sigma
        self.num_keypoints = len(keypoint_names)
        self.num_bins_x = int(input_size[1] * split_ratio)
        self.num_bins_y = int(input_size[0] * split_ratio)

        images_by_id = {img["id"]: img for img in data["images"]}
        self.samples = []
        for ann in data["annotations"]:
            if ann.get("num_keypoints", 0) == 0 or ann.get("iscrowd", 0):
                continue
            image_info = images_by_id[ann["image_id"]]
            self.samples.append(
                {
                    "file_name": image_info["file_name"],
                    "bbox": ann["bbox"],  # (x, y, w, h)
                    "keypoints": ann["keypoints"],  # flat [x,y,v] * num_keypoints, COCO order
                }
            )

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int):
        sample = self.samples[idx]
        img_path = os.path.join(self.images_dir, sample["file_name"])
        img = cv2.cvtColor(cv2.imread(img_path), cv2.COLOR_BGR2RGB)

        x, y, w, h = sample["bbox"]
        aspect_ratio = self.input_size[1] / self.input_size[0]  # w/h
        center, size = box_to_center_size((x, y, x + w, y + h), aspect_ratio=aspect_ratio)
        trans = get_affine_transform(center, size, (self.input_size[1], self.input_size[0]))
        crop = cv2.warpAffine(img, trans, (self.input_size[1], self.input_size[0]), flags=cv2.INTER_LINEAR)

        kpts = np.array(sample["keypoints"], dtype=np.float32).reshape(-1, 3)  # (K, [x,y,v])
        xy_crop = affine_transform_points(kpts[:, :2], trans)
        visibility = kpts[:, 2]

        label_x = np.zeros((self.num_keypoints, self.num_bins_x), dtype=np.float32)
        label_y = np.zeros((self.num_keypoints, self.num_bins_y), dtype=np.float32)
        target_weight = np.zeros((self.num_keypoints,), dtype=np.float32)

        for k in range(self.num_keypoints):
            if visibility[k] > 0:
                lx, ly = encode_simcc_label(
                    xy_crop[k, 0], xy_crop[k, 1], self.num_bins_x, self.num_bins_y, self.split_ratio, self.sigma
                )
                label_x[k], label_y[k] = lx, ly
                target_weight[k] = 1.0

        return {
            "image": normalize_crop(crop),
            "label_x": torch.from_numpy(label_x),
            "label_y": torch.from_numpy(label_y),
            "target_weight": torch.from_numpy(target_weight),
        }
