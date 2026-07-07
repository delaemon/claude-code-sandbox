#!/usr/bin/env python3
"""End-to-end inference: iPhone front-view golf swing video -> skeleton
keypoints (JSON), swing-phase events (JSON), and an annotated video.

Usage:
    python infer.py --video swing.mov --out_dir outputs/ \\
        --pose_checkpoint weights/pose_best.pt \\
        --event_checkpoint weights/event_best.pt

If no checkpoints are given, the pose/event heads run with random
initialization (only the backbone is ImageNet-pretrained) -- the pipeline
will still run to completion, but keypoints and swing-phase predictions
will not be meaningful. See README.md for how to train real weights.
"""

import argparse
import json
import logging
import os

import torch

from models.detector import PersonDetector
from models.event_head import SwingEventModel, decode_events
from models.pose_model import build_pose_model, load_checkpoint, load_config
from pipeline.pose_sequence import extract_pose_sequence
from pipeline.smoothing import KeypointSmoother
from pipeline.video_io import VideoReader, VideoWriter, rotate_frame
from pipeline.visualize import draw_event_label, draw_skeleton

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--video", required=True, help="Path to the input iPhone front-view swing video")
    p.add_argument("--out_dir", default="outputs", help="Directory to write skeleton.json / swing_events.json / annotated.mp4")
    p.add_argument("--pose_config", default=os.path.join(os.path.dirname(__file__), "configs", "pose.yaml"))
    p.add_argument("--events_config", default=os.path.join(os.path.dirname(__file__), "configs", "events.yaml"))
    p.add_argument("--pose_checkpoint", default=None, help="Trained PoseModel checkpoint (see train_pose.py)")
    p.add_argument("--event_checkpoint", default=None, help="Trained SwingEventModel checkpoint (see train_events.py)")
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    p.add_argument("--detect_every_n", type=int, default=5, help="Re-run the person detector every N frames; bbox is tracked/carried forward in between")
    p.add_argument("--detector_score_thresh", type=float, default=0.5)
    p.add_argument("--keypoint_score_thresh", type=float, default=0.3, help="Below this confidence, a joint is not drawn in the annotated video")
    p.add_argument("--rotate", type=int, default=0, choices=[0, 90, 180, 270], help="Manual rotation override if the video's orientation metadata isn't honored")
    args = p.parse_args()
    if args.detect_every_n < 1:
        p.error("--detect_every_n must be >= 1")
    return args


def main():
    args = parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    pose_config = load_config(args.pose_config)
    events_config = load_config(args.events_config)
    keypoint_names = pose_config["keypoints"]
    skeleton_edges = [tuple(e) for e in pose_config["skeleton_edges"]]

    if args.pose_checkpoint is None or args.event_checkpoint is None:
        log.warning(
            "Running without trained checkpoint(s): the backbone is ImageNet-pretrained "
            "but the pose/event heads are randomly initialized, so predictions will not "
            "be meaningful. Run train_pose.py / train_events.py first for real accuracy."
        )

    pose_model = build_pose_model(args.pose_config, checkpoint_path=args.pose_checkpoint, device=args.device)
    event_model = SwingEventModel(
        in_channels=pose_model.backbone.out_channels,
        event_names=events_config["events"],
        hidden_dim=events_config["lstm_hidden_dim"],
        num_layers=events_config["lstm_num_layers"],
        bidirectional=events_config["bidirectional"],
        dropout=events_config["dropout"],
    ).to(args.device)
    if args.event_checkpoint:
        load_checkpoint(event_model, args.event_checkpoint, device=args.device)
    event_model.eval()

    detector = PersonDetector(device=args.device, score_thresh=args.detector_score_thresh)

    reader = VideoReader(args.video)
    fps, width, height = reader.fps, reader.width, reader.height
    log.info(f"Video: {width}x{height} @ {fps:.2f}fps, ~{reader.frame_count} frames")

    frames_rgb = [rotate_frame(f, args.rotate) if args.rotate else f for f in reader]
    reader.release()
    num_frames = len(frames_rgb)
    if num_frames == 0:
        raise ValueError(f"No frames could be read from {args.video}")

    # If the video was rotated 90/270 degrees, height and width swap relative
    # to the container's reported dimensions -- the annotated video writer
    # must use the post-rotation frame shape or every write() call mismatches.
    if args.rotate in (90, 270):
        width, height = height, width

    log.info(f"Running person detection + pose estimation over {num_frames} frames")
    all_xs, all_ys, all_scores, all_boxes, pooled_feats = extract_pose_sequence(
        frames_rgb, pose_model, detector, device=args.device, detect_every_n=args.detect_every_n
    )

    smoother = KeypointSmoother(len(keypoint_names), fps=fps)
    for i in range(num_frames):
        all_xs[i], all_ys[i] = smoother.smooth(all_xs[i], all_ys[i])

    log.info("Running swing-phase detection")
    feats_seq = torch.stack(pooled_feats, dim=0).unsqueeze(0).to(args.device)  # (1, T, C)
    with torch.no_grad():
        event_logits = event_model(feats_seq).squeeze(0)  # (T, num_classes)
    event_frames, event_scores = decode_events(event_logits, events_config["events"])
    if len(set(event_frames)) < len(event_frames):
        log.warning(
            "Swing event frames collapsed onto duplicate indices (clip shorter than the "
            "number of events, or the event model is untrained) -- swing_events.json will "
            "list distinct events at the same frame number."
        )

    skeleton_out = []
    for i in range(num_frames):
        skeleton_out.append(
            {
                "frame": i,
                "timestamp_sec": round(i / fps, 4),
                "bbox": all_boxes[i],
                "keypoints": [
                    {"name": name, "x": float(all_xs[i][k]), "y": float(all_ys[i][k]), "score": float(all_scores[i][k])}
                    for k, name in enumerate(keypoint_names)
                ],
            }
        )
    with open(os.path.join(args.out_dir, "skeleton.json"), "w") as f:
        json.dump(skeleton_out, f, indent=2)

    events_out = [
        {"event": name, "frame": frame, "timestamp_sec": round(frame / fps, 4), "score": float(score)}
        for name, frame, score in zip(events_config["events"], event_frames, event_scores)
    ]
    with open(os.path.join(args.out_dir, "swing_events.json"), "w") as f:
        json.dump(events_out, f, indent=2)

    log.info("Rendering annotated video")
    writer = VideoWriter(os.path.join(args.out_dir, "annotated.mp4"), fps, width, height)
    event_label_by_frame = {e["frame"]: e["event"] for e in events_out}
    for i, frame in enumerate(frames_rgb):
        out_frame = draw_skeleton(
            frame, all_xs[i], all_ys[i], all_scores[i], skeleton_edges, score_thresh=args.keypoint_score_thresh
        )
        if i in event_label_by_frame:
            out_frame = draw_event_label(out_frame, event_label_by_frame[i])
        writer.write(out_frame)
    writer.release()

    log.info(f"Done. Wrote skeleton.json, swing_events.json, annotated.mp4 to {args.out_dir}")


if __name__ == "__main__":
    main()
