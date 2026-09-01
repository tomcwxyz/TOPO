#!/usr/bin/env python3
"""Install TOPO's Hermes general plugin into the current user's Hermes profile."""
from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "adapters" / "hermes"
DESTINATION = Path.home() / ".hermes" / "plugins" / "topo"

if not SOURCE.exists():
    raise SystemExit(f"TOPO Hermes adapter not found: {SOURCE}")

DESTINATION.mkdir(parents=True, exist_ok=True)
for name in ("plugin.yaml", "__init__.py", "README.md"):
    shutil.copy2(SOURCE / name, DESTINATION / name)

print(f"Installed TOPO Hermes plugin to {DESTINATION}")
print("Next: hermes plugins enable topo")
print("Then restart Hermes and enable the desired local permissions in TOPO Desktop.")
