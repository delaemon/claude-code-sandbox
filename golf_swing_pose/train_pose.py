#!/usr/bin/env python3
"""Train PoseModel's SimCC head (and optionally fine-tune the backbone) on
a COCO-format keypoints dataset. This is the step that actually gives the
model real accuracy -- without it, infer.py only has an ImageNet-pretrained
backbone feeding a randomly-initialized head.

Usage:
    python train_pose.py --images_dir /data/coco/train2017 \\
        --annotation_file /data/coco/annotations/person_keypoints_train2017.json \\
        --epochs 60 --out weights/pose_best.pt

For best results on golf swings specifically, first pretrain on COCO, then
run a second fine-tuning pass pointing --images_dir/--annotation_file at a
COCO-format dataset of golf swing frames (own or GolfDB-derived).
"""

import argparse
import os

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader
from tqdm import tqdm

from data.coco_keypoints_dataset import CocoKeypointsDataset
from models.pose_model import PoseModel, load_checkpoint, load_config


def simcc_loss(x_logits, y_logits, label_x, label_y, target_weight):
    """KL-divergence between predicted and gaussian-smoothed target
    distributions per axis (Li et al., SimCC, ECCV 2022), masked by
    keypoint visibility (target_weight).
    """
    log_px = F.log_softmax(x_logits, dim=-1)
    log_py = F.log_softmax(y_logits, dim=-1)
    loss_x = F.kl_div(log_px, label_x, reduction="none").sum(-1)  # (B, K)
    loss_y = F.kl_div(log_py, label_y, reduction="none").sum(-1)
    denom = target_weight.sum() * 2 + 1e-8
    return ((loss_x + loss_y) * target_weight).sum() / denom


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--images_dir", required=True)
    p.add_argument("--annotation_file", required=True)
    p.add_argument("--pose_config", default=os.path.join(os.path.dirname(__file__), "configs", "pose.yaml"))
    p.add_argument("--epochs", type=int, default=60)
    p.add_argument("--batch_size", type=int, default=32)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--freeze_backbone", action="store_true", help="Keep the ImageNet-pretrained backbone frozen; train only the SimCC head")
    p.add_argument("--resume", default=None, help="Checkpoint to resume/fine-tune from")
    p.add_argument("--out", default="weights/pose_best.pt")
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    p.add_argument("--num_workers", type=int, default=4)
    return p.parse_args()


def main():
    args = parse_args()
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    config = load_config(args.pose_config)

    model = PoseModel(config, pretrained_backbone=args.resume is None, freeze_backbone=args.freeze_backbone)
    if args.resume:
        load_checkpoint(model, args.resume, device=args.device)
    model.to(args.device)

    dataset = CocoKeypointsDataset(
        images_dir=args.images_dir,
        annotation_file=args.annotation_file,
        keypoint_names=config["keypoints"],
        input_size=tuple(config["input_size"]),
        split_ratio=config["simcc_split_ratio"],
    )
    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=True, num_workers=args.num_workers, drop_last=True)

    params = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(params, lr=args.lr)

    best_loss = float("inf")
    for epoch in range(args.epochs):
        model.train()
        running_loss = 0.0
        pbar = tqdm(loader, desc=f"epoch {epoch + 1}/{args.epochs}")
        for batch in pbar:
            images = batch["image"].to(args.device)
            label_x = batch["label_x"].to(args.device)
            label_y = batch["label_y"].to(args.device)
            target_weight = batch["target_weight"].to(args.device)

            x_logits, y_logits, _ = model(images)
            loss = simcc_loss(x_logits, y_logits, label_x, label_y, target_weight)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            running_loss += loss.item()
            pbar.set_postfix(loss=running_loss / (pbar.n + 1))

        epoch_loss = running_loss / len(loader)
        if epoch_loss < best_loss:
            best_loss = epoch_loss
            torch.save({"model": model.state_dict(), "config": config, "epoch": epoch}, args.out)
            print(f"Saved new best checkpoint (loss={best_loss:.4f}) to {args.out}")


if __name__ == "__main__":
    main()
