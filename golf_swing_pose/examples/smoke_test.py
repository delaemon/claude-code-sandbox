#!/usr/bin/env python3
"""Integration smoke test: generates a short synthetic video and runs it
through infer.py end-to-end, checking that the pipeline completes and
produces well-formed output files.

This does NOT validate pose/event accuracy (the synthetic video contains no
real person, so the detector is expected to find nobody -- infer.py's
zero-confidence fallback path is what's being exercised here). Its purpose
is to catch integration bugs: shape mismatches, codec issues, JSON
serialization, CLI argument wiring, etc.

Usage: python examples/smoke_test.py
"""

import json
import os
import subprocess
import sys
import tempfile

import cv2
import numpy as np

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def make_synthetic_video(path: str, num_frames: int = 30, width: int = 480, height: int = 270, fps: float = 30.0):
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    for i in range(num_frames):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        cx = int(width * 0.2 + width * 0.6 * (i / num_frames))
        cv2.circle(frame, (cx, height // 2), 20, (0, 200, 0), -1)
        writer.write(frame)
    writer.release()


def main():
    with tempfile.TemporaryDirectory() as tmp:
        video_path = os.path.join(tmp, "synthetic_swing.mp4")
        out_dir = os.path.join(tmp, "outputs")
        make_synthetic_video(video_path)

        cmd = [
            sys.executable,
            os.path.join(REPO_ROOT, "infer.py"),
            "--video", video_path,
            "--out_dir", out_dir,
            "--device", "cpu",
        ]
        result = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True)
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        if result.returncode != 0:
            print("SMOKE TEST FAILED: infer.py exited with an error", file=sys.stderr)
            sys.exit(1)

        skeleton_path = os.path.join(out_dir, "skeleton.json")
        events_path = os.path.join(out_dir, "swing_events.json")
        video_out_path = os.path.join(out_dir, "annotated.mp4")

        for path in (skeleton_path, events_path, video_out_path):
            assert os.path.exists(path), f"missing expected output: {path}"

        with open(skeleton_path) as f:
            skeleton = json.load(f)
        with open(events_path) as f:
            events = json.load(f)

        assert len(skeleton) == 30, f"expected 30 frames of skeleton data, got {len(skeleton)}"
        assert len(events) == 8, f"expected 8 swing events, got {len(events)}"
        assert os.path.getsize(video_out_path) > 0, "annotated.mp4 is empty"

        print("SMOKE TEST PASSED: pipeline ran end-to-end and produced well-formed outputs.")


if __name__ == "__main__":
    main()
