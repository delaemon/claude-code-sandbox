"""Swing-phase (event) detection head.

Follows SwingNet (McNally et al., "Golf Swing Sequencing Using Deep
Learning", GolfDB, CVPRW 2019): per-frame CNN features are fed through a
bidirectional LSTM that classifies each frame into one of the 8 golf swing
events (address, toe-up, mid-backswing, top, mid-downswing, impact,
follow-through, finish) or "none". Unlike SwingNet's MobileNetV2 features,
we reuse the pooled ConvNeXt backbone features already computed by
PoseModel for the same frame, avoiding a second CNN forward pass per frame.
"""

from typing import List, Tuple

import torch
import torch.nn as nn


class SwingEventModel(nn.Module):
    def __init__(
        self,
        in_channels: int,
        event_names: List[str],
        hidden_dim: int = 256,
        num_layers: int = 2,
        bidirectional: bool = True,
        dropout: float = 0.3,
    ):
        super().__init__()
        self.event_names = list(event_names)
        num_classes = len(self.event_names) + 1  # +1 for the implicit "none" class

        self.lstm = nn.LSTM(
            input_size=in_channels,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            bidirectional=bidirectional,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        out_dim = hidden_dim * (2 if bidirectional else 1)
        self.classifier = nn.Linear(out_dim, num_classes)

    def forward(self, feats: torch.Tensor) -> torch.Tensor:
        """feats: (B, T, C) pooled per-frame features -> (B, T, num_classes) logits."""
        out, _ = self.lstm(feats)
        return self.classifier(out)


@torch.no_grad()
def decode_events(logits: torch.Tensor, event_names: List[str]) -> Tuple[List[int], List[float]]:
    """Decode a single clip's per-frame logits into one frame index per event.

    logits: (T, num_classes) for one video (batch size 1, squeezed).
    Picks the highest-confidence frame per event class (as in the SwingNet
    evaluation protocol), then nudges frames forward as needed so the
    returned indices are strictly increasing -- golf swing events always
    occur in this fixed temporal order within a single swing.
    """
    probs = torch.softmax(logits, dim=-1)
    num_frames = probs.shape[0]
    num_events = len(event_names)

    event_probs = probs[:, :num_events]  # exclude the trailing "none" class
    frames = event_probs.argmax(dim=0).tolist()

    for i in range(1, num_events):
        if frames[i] <= frames[i - 1]:
            frames[i] = frames[i - 1] + 1
    frames = [min(f, num_frames - 1) for f in frames]

    # Re-read the confidence at each event's *final* (possibly nudged/clamped)
    # frame, not its raw pre-nudge argmax -- otherwise a reported score can
    # describe a different frame than the one actually returned.
    scores = [event_probs[frames[i], i].item() for i in range(num_events)]

    return frames, scores
