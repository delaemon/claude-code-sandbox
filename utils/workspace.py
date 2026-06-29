"""Workspace management: a dedicated directory where agents read/write artifacts."""
import os
import json
import shutil
from pathlib import Path
from datetime import datetime


class Workspace:
    def __init__(self, base_dir: str = "workspace"):
        self.base = Path(base_dir)
        self.run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.root = self.base / self.run_id
        self.root.mkdir(parents=True, exist_ok=True)
        self.meta: dict = {}

    # ── file operations ──────────────────────────────────────────────────────

    def write(self, rel_path: str, content: str) -> str:
        """Write content to a file inside the workspace; returns absolute path."""
        target = self.root / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return str(target)

    def read(self, rel_path: str) -> str:
        """Read a file from the workspace."""
        return (self.root / rel_path).read_text(encoding="utf-8")

    def list_files(self, subdir: str = ".") -> list[str]:
        """Return all files relative to the workspace root."""
        base = self.root / subdir
        if not base.exists():
            return []
        return [
            str(p.relative_to(self.root))
            for p in sorted(base.rglob("*"))
            if p.is_file()
        ]

    def exists(self, rel_path: str) -> bool:
        return (self.root / rel_path).exists()

    def abs(self, rel_path: str) -> str:
        return str(self.root / rel_path)

    # ── metadata helpers ─────────────────────────────────────────────────────

    def set_meta(self, key: str, value) -> None:
        self.meta[key] = value
        (self.root / "_meta.json").write_text(json.dumps(self.meta, indent=2))

    def get_meta(self, key: str, default=None):
        return self.meta.get(key, default)

    def __str__(self) -> str:
        return str(self.root)
