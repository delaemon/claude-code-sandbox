"""SimCC-style keypoint head.

Instead of regressing 2D heatmaps (as most classic pose estimators do,
including the network under MediaPipe's BlazePose), we follow SimCC
(Li et al., "SimCC: a Simple Coordinate Classification Perspective for
Human Pose Estimation", ECCV 2022, arXiv:2107.03332) and RTMPose's adoption
of it (Jiang et al., 2023, arXiv:2303.07399): each axis is treated as an
independent classification problem over finely discretized bins, which
avoids the quantization error of heatmap downsampling and is reported to
give both higher accuracy and lower latency than heatmap-based heads.

The per-keypoint embedding is produced by a small cross-attention block
(learned keypoint queries attending over the backbone's spatial feature
map), loosely in the spirit of RTMPose's Gated Attention Unit head but
implemented here as a standard multi-head attention block to keep the
implementation compact and easy to reason about.
"""

from typing import Tuple

import torch
import torch.nn as nn


class SimCCHead(nn.Module):
    def __init__(
        self,
        in_channels: int,
        num_keypoints: int,
        input_size: Tuple[int, int] = (256, 192),
        hidden_dim: int = 256,
        num_heads: int = 4,
        split_ratio: float = 2.0,
    ):
        super().__init__()
        height, width = input_size
        self.split_ratio = split_ratio
        self.num_bins_x = int(width * split_ratio)
        self.num_bins_y = int(height * split_ratio)

        self.input_proj = nn.Linear(in_channels, hidden_dim)
        self.keypoint_queries = nn.Parameter(torch.randn(num_keypoints, hidden_dim) * 0.02)
        self.attn = nn.MultiheadAttention(hidden_dim, num_heads, batch_first=True)
        self.norm1 = nn.LayerNorm(hidden_dim)
        self.ffn = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim * 2),
            nn.GELU(),
            nn.Linear(hidden_dim * 2, hidden_dim),
        )
        self.norm2 = nn.LayerNorm(hidden_dim)
        self.x_fc = nn.Linear(hidden_dim, self.num_bins_x)
        self.y_fc = nn.Linear(hidden_dim, self.num_bins_y)

    def forward(self, feat_map: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """feat_map: (B, C, h, w) -> (x_logits (B,K,num_bins_x), y_logits (B,K,num_bins_y))."""
        b = feat_map.shape[0]
        tokens = feat_map.flatten(2).transpose(1, 2)  # (B, h*w, C)
        tokens = self.input_proj(tokens)

        queries = self.keypoint_queries.unsqueeze(0).expand(b, -1, -1)  # (B, K, hidden)
        attn_out, _ = self.attn(queries, tokens, tokens)
        x = self.norm1(queries + attn_out)
        x = self.norm2(x + self.ffn(x))

        return self.x_fc(x), self.y_fc(x)


def decode_simcc(
    x_logits: torch.Tensor, y_logits: torch.Tensor, split_ratio: float
) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Soft-argmax decode of SimCC logits into sub-pixel (x, y) + confidence.

    Returns three (B, K) tensors: x in crop pixel coords, y in crop pixel
    coords, and a confidence score in [0, 1] (mean of the per-axis max
    softmax probability).
    """
    x_probs = torch.softmax(x_logits, dim=-1)
    y_probs = torch.softmax(y_logits, dim=-1)

    x_bins = torch.arange(x_probs.shape[-1], device=x_probs.device, dtype=x_probs.dtype)
    y_bins = torch.arange(y_probs.shape[-1], device=y_probs.device, dtype=y_probs.dtype)

    x_coord = (x_probs * x_bins).sum(-1) / split_ratio
    y_coord = (y_probs * y_bins).sum(-1) / split_ratio
    confidence = (x_probs.amax(-1) + y_probs.amax(-1)) / 2.0

    return x_coord, y_coord, confidence
