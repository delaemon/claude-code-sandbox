"""ConvNeXt-Tiny feature backbone, ImageNet-pretrained via torchvision.

RTMPose (Jiang et al., 2023, arXiv:2303.07399) pretrains its CSPNeXt backbone
on ImageNet before attaching a pose head. We follow the same transfer-learning
recipe but reuse torchvision's ConvNeXt-Tiny (Liu et al., 2022) as the
backbone, since a from-scratch CSPNeXt has no available pretrained weights
in this environment. Only the head (see pose_head.py) is novel/trainable
from random initialization.
"""

import torch
import torch.nn as nn
import torchvision

from .pretrained import build_with_pretrained_fallback


class ConvNeXtBackbone(nn.Module):
    """Strips the classification head off torchvision's ConvNeXt-Tiny.

    Exposes both the final spatial feature map (for the SimCC pose head) and
    a global-average-pooled vector (reused by the event model so we don't
    run two separate CNNs over the same frame).
    """

    def __init__(self, pretrained: bool = True, freeze: bool = False):
        super().__init__()
        weights = (
            torchvision.models.ConvNeXt_Tiny_Weights.IMAGENET1K_V1
            if pretrained
            else None
        )
        convnext = build_with_pretrained_fallback(
            torchvision.models.convnext_tiny, weights, description="ConvNeXt-Tiny backbone"
        )
        self.features = convnext.features  # Sequential of downsampling stages
        self.out_channels = 768  # convnext_tiny's final stage channel count

        if freeze:
            for p in self.features.parameters():
                p.requires_grad = False

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: (B, 3, H, W) -> feature map (B, out_channels, H/32, W/32)."""
        return self.features(x)

    def pooled(self, feat_map: torch.Tensor) -> torch.Tensor:
        """Global-average-pool a feature map to (B, out_channels)."""
        return feat_map.mean(dim=(2, 3))
