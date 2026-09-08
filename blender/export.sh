#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.local/bin:${PATH}"
if ! command -v blender >/dev/null 2>&1; then
  echo "blender CLI not found. Install the official Linux tarball and put blender on PATH." >&2
  exit 1
fi
blender -b -P "${ROOT}/blender/generate_assets.py" -- "${ROOT}"
