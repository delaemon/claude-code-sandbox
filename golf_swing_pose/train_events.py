#!/usr/bin/env python3
"""Train SwingEventModel to detect the 8 golf swing phases (SwingNet/GolfDB
style) from a directory of single-swing video clips + a JSON manifest of
event frame indices (see data/golfdb_dataset.py for the expected format).

Usage:
    python train_events.py --videos_dir /data/golfdb/clips \\
        --annotation_file /data/golfdb/annotations.json \\
        --pose_checkpoint weights/pose_best.pt --epochs 30 --out weights/event_best.pt
"""

import argparse
import os

import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from tqdm import tqdm

from data.golfdb_dataset import GolfDBEventDataset
from models.detector import PersonDetector
from models.event_head import SwingEventModel
from models.pose_model import build_pose_model, load_config


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--videos_dir", required=True)
    p.add_argument("--annotation_file", required=True)
    p.add_argument("--pose_config", default=os.path.join(os.path.dirname(__file__), "configs", "pose.yaml"))
    p.add_argument("--events_config", default=os.path.join(os.path.dirname(__file__), "configs", "events.yaml"))
    p.add_argument("--pose_checkpoint", required=True, help="Trained PoseModel checkpoint, used as a frozen feature extractor")
    p.add_argument("--epochs", type=int, default=30)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--out", default="weights/event_best.pt")
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    p.add_argument("--detect_every_n", type=int, default=5, help="Re-run the person detector every N frames when extracting per-clip features")
    return p.parse_args()


def main():
    args = parse_args()
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    events_config = load_config(args.events_config)
    event_names = events_config["events"]

    pose_model = build_pose_model(args.pose_config, checkpoint_path=args.pose_checkpoint, device=args.device)
    for param in pose_model.parameters():
        param.requires_grad = False
    detector = PersonDetector(device=args.device)

    dataset = GolfDBEventDataset(
        args.videos_dir,
        args.annotation_file,
        pose_model,
        detector,
        event_names,
        device=args.device,
        detect_every_n=args.detect_every_n,
    )
    # Clips have different lengths, so we train with an effective batch size of 1 (one clip per step).
    loader = DataLoader(dataset, batch_size=1, shuffle=True)

    model = SwingEventModel(
        in_channels=pose_model.backbone.out_channels,
        event_names=event_names,
        hidden_dim=events_config["lstm_hidden_dim"],
        num_layers=events_config["lstm_num_layers"],
        bidirectional=events_config["bidirectional"],
        dropout=events_config["dropout"],
    ).to(args.device)

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr)
    criterion = nn.CrossEntropyLoss()

    best_loss = float("inf")
    for epoch in range(args.epochs):
        model.train()
        running_loss = 0.0
        pbar = tqdm(loader, desc=f"epoch {epoch + 1}/{args.epochs}")
        for batch in pbar:
            feats = batch["features"].to(args.device)  # (1, T, C)
            labels = batch["labels"].to(args.device)  # (1, T)

            logits = model(feats)  # (1, T, num_classes)
            loss = criterion(logits.squeeze(0), labels.squeeze(0))

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            running_loss += loss.item()
            pbar.set_postfix(loss=running_loss / (pbar.n + 1))

        epoch_loss = running_loss / len(loader)
        if epoch_loss < best_loss:
            best_loss = epoch_loss
            torch.save({"model": model.state_dict(), "events_config": events_config, "epoch": epoch}, args.out)
            print(f"Saved new best checkpoint (loss={best_loss:.4f}) to {args.out}")


if __name__ == "__main__":
    main()
