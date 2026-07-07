"""Central configuration. Everything is overridable via environment variables
so the same code runs unchanged on the open- and closed-track submission images."""
import os

# Model used by the solve/verify/repair agents. Closed track: strongest available
# model wins; open track: point this at a local OpenAI-compatible endpoint via
# DAB_BASE_URL and swap the client in llm.py.
MODEL = os.environ.get("DAB_MODEL", "claude-opus-4-8")
MAX_TOKENS = int(os.environ.get("DAB_MAX_TOKENS", "8192"))

# Agentic loop budget. The official baseline uses 16; exploration is done
# deterministically before the loop starts, so most steps go to actual solving.
MAX_STEPS = int(os.environ.get("DAB_MAX_STEPS", "30"))

# Self-consistency: number of independent solve runs and their temperatures.
N_SAMPLES = int(os.environ.get("DAB_N_SAMPLES", "3"))
TEMPERATURES = [0.2, 0.7, 1.0, 0.5, 0.9]  # first N_SAMPLES are used

# Cross-route verification (SQL vs pandas). Costs one extra solve run when the
# consensus is weak; disable with DAB_VERIFY=0 for cheap sweeps.
VERIFY = os.environ.get("DAB_VERIFY", "1") == "1"

# Python snippet execution limits inside the sandbox.
PY_TIMEOUT_SEC = int(os.environ.get("DAB_PY_TIMEOUT", "120"))
TOOL_OUTPUT_LIMIT = int(os.environ.get("DAB_TOOL_OUTPUT_LIMIT", "4000"))

# Context profile size budget (chars) injected into the first prompt.
PROFILE_CHAR_BUDGET = int(os.environ.get("DAB_PROFILE_BUDGET", "9000"))

# Numeric comparison tolerance used by canonicalization / voting / scoring.
REL_TOL = 1e-6
ABS_TOL = 1e-9
