"""Combines the ConvNeXt backbone with the SimCC head into one pose model."""

from typing import Optional, Tuple

import torch
import torch.nn as nn
import yaml

from .backbone import ConvNeXtBackbone
from .pose_head import SimCCHead, decode_simcc


class PoseModel(nn.Module):
    def __init__(self, config: dict, pretrained_backbone: bool = True, freeze_backbone: bool = False):
        super().__init__()
        self.keypoint_names = list(config["keypoints"])
        self.input_size = tuple(config["input_size"])  # (H, W)
        self.split_ratio = float(config["simcc_split_ratio"])

        self.backbone = ConvNeXtBackbone(pretrained=pretrained_backbone, freeze=freeze_backbone)
        self.head = SimCCHead(
            in_channels=self.backbone.out_channels,
            num_keypoints=len(self.keypoint_names),
            input_size=self.input_size,
            hidden_dim=config["head_hidden_dim"],
            num_heads=config["num_attention_heads"],
            split_ratio=self.split_ratio,
        )

    def forward(self, x: torch.Tensor):
        """x: (B, 3, H, W) crop -> (x_logits, y_logits, backbone_feat_map)."""
        feat_map = self.backbone(x)
        x_logits, y_logits = self.head(feat_map)
        return x_logits, y_logits, feat_map

    @torch.no_grad()
    def predict(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Inference helper. Returns (x_px, y_px, confidence, pooled_feat).

        x_px/y_px/confidence are (B, num_keypoints) in the crop's own pixel
        coordinate frame (i.e. [0, input_size[1]) x [0, input_size[0])).
        pooled_feat is (B, backbone.out_channels), reused by the event model.
        """
        self.eval()
        x_logits, y_logits, feat_map = self.forward(x)
        x_px, y_px, conf = decode_simcc(x_logits, y_logits, self.split_ratio)
        pooled = self.backbone.pooled(feat_map)
        return x_px, y_px, conf, pooled


def load_config(config_path: str) -> dict:
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def load_checkpoint(model: nn.Module, checkpoint_path: str, device: str = "cpu") -> None:
    """Loads a checkpoint saved by train_pose.py/train_events.py (which wrap
    the state dict as {"model": ...}) or a bare state dict, in place.
    """
    state = torch.load(checkpoint_path, map_location=device)
    model.load_state_dict(state["model"] if "model" in state else state)


def build_pose_model(
    config_path: str,
    checkpoint_path: Optional[str] = None,
    pretrained_backbone: bool = True,
    device: str = "cpu",
) -> PoseModel:
    config = load_config(config_path)
    model = PoseModel(config, pretrained_backbone=pretrained_backbone and checkpoint_path is None)
    if checkpoint_path:
        load_checkpoint(model, checkpoint_path, device=device)
    model.to(device)
    model.eval()
    return model
