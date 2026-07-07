"""Shared "try pretrained weights, fall back to random init" helper.

Downloading torchvision's hosted checkpoints requires network access to
download.pytorch.org, which isn't available in every deployment (offline
hosts, restricted egress policies, etc). Both ConvNeXtBackbone and
PersonDetector need the same fallback behavior, so it lives here once
instead of being copy-pasted per model.
"""

import logging
from typing import Any, Callable

log = logging.getLogger(__name__)


def build_with_pretrained_fallback(
    builder: Callable[..., Any],
    weights: Any,
    description: str,
    **fallback_kwargs: Any,
) -> Any:
    """Calls `builder(weights=weights)`. If that raises while downloading a
    real (non-None) `weights` checkpoint, logs a warning and retries as
    `builder(weights=None, **fallback_kwargs)` (random initialization).
    """
    try:
        return builder(weights=weights)
    except (RuntimeError, OSError) as e:
        if weights is None:
            raise
        log.warning(
            "Could not download pretrained weights for %s (%s). Falling back to random "
            "initialization -- accuracy will be significantly worse until the model is "
            "trained/fine-tuned. Pre-download the weights and set TORCH_HOME, or retry "
            "with network access, to use the pretrained weights.",
            description,
            e,
        )
        return builder(weights=None, **fallback_kwargs)
