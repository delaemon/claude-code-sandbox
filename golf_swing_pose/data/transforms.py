"""Top-down crop transform and SimCC label encoding, shared by training and inference."""

from typing import Tuple

import numpy as np
import torch

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def normalize_crop(crop_rgb_uint8: np.ndarray) -> torch.Tensor:
    """HxWx3 uint8 RGB crop -> normalized (3,H,W) float tensor, using
    ImageNet statistics since the backbone is ImageNet-pretrained.
    """
    img = crop_rgb_uint8.astype(np.float32) / 255.0
    img = (img - IMAGENET_MEAN) / IMAGENET_STD
    return torch.from_numpy(img).permute(2, 0, 1).float()


def box_to_center_size(box: Tuple[float, float, float, float], aspect_ratio: float, padding: float = 1.25):
    """box: (x1,y1,x2,y2) -> (center_xy, size_wh) padded and adjusted to aspect_ratio (w/h)."""
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    center = np.array([x1 + w / 2.0, y1 + h / 2.0], dtype=np.float32)

    if w > aspect_ratio * h:
        h = w / aspect_ratio
    else:
        w = h * aspect_ratio

    size = np.array([w, h], dtype=np.float32) * padding
    return center, size


def get_affine_transform(center: np.ndarray, size_wh: np.ndarray, output_size_wh: Tuple[int, int]) -> np.ndarray:
    """Pure scale+translate affine (no rotation -- not needed for a roughly
    upright, front-facing golf swing crop) mapping source crop -> output_size.
    Returns a (2,3) matrix usable directly with cv2.warpAffine.
    """
    src_w, src_h = size_wh
    dst_w, dst_h = output_size_wh
    scale_x, scale_y = dst_w / src_w, dst_h / src_h
    cx, cy = center

    return np.array(
        [
            [scale_x, 0.0, dst_w / 2.0 - scale_x * cx],
            [0.0, scale_y, dst_h / 2.0 - scale_y * cy],
        ],
        dtype=np.float32,
    )


def invert_affine_transform(trans: np.ndarray) -> np.ndarray:
    m = np.vstack([trans, [0.0, 0.0, 1.0]])
    return np.linalg.inv(m)[:2, :]


def affine_transform_points(points_xy: np.ndarray, trans: np.ndarray) -> np.ndarray:
    """points_xy: (N,2) -> (N,2) transformed by the (2,3) affine matrix."""
    ones = np.ones((points_xy.shape[0], 1), dtype=points_xy.dtype)
    homo = np.concatenate([points_xy, ones], axis=1)  # (N,3)
    return homo @ trans.T


def encode_simcc_label(
    x: float, y: float, num_bins_x: int, num_bins_y: int, split_ratio: float, sigma: float = 2.0
) -> Tuple[np.ndarray, np.ndarray]:
    """Gaussian-smoothed 1D classification targets for SimCC training
    (Li et al., ECCV 2022): a soft label over discretized bins is used
    instead of a one-hot target so nearby bins still get partial credit.
    """
    mu_x, mu_y = x * split_ratio, y * split_ratio

    bins_x = np.arange(num_bins_x, dtype=np.float32)
    bins_y = np.arange(num_bins_y, dtype=np.float32)

    label_x = np.exp(-((bins_x - mu_x) ** 2) / (2 * sigma**2))
    label_y = np.exp(-((bins_y - mu_y) ** 2) / (2 * sigma**2))

    label_x /= label_x.sum() + 1e-8
    label_y /= label_y.sum() + 1e-8
    return label_x, label_y
