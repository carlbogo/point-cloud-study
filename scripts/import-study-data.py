"""Import a private study ZIP without extracting arbitrary archive paths."""

import argparse
import json
import subprocess
import sys
import uuid
import zipfile
from pathlib import Path, PurePosixPath

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("archive", type=Path)
args = parser.parse_args()
folder = root / "data/bundles" / uuid.uuid4().hex
with zipfile.ZipFile(args.archive) as archive:
    manifest = json.loads(archive.read("manifest.json"))
    items = manifest.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("The study archive has no image manifest.")
    for item in items:
        path = PurePosixPath(item["image"])
        if (
            len(path.parts) != 2
            or path.parts[0] != "images"
            or path.suffix.lower() != ".png"
            or ".." in path.parts
            or "\\" in str(path)
        ):
            raise ValueError("Invalid image path in study archive.")
        file = folder / Path(*path.parts)
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(archive.read(str(path)))
folder.mkdir(parents=True, exist_ok=True)
file = folder / "manifest.json"
file.write_text(json.dumps(manifest, indent=2))
subprocess.run([sys.executable, str(root / "scripts/prepare-stimuli.py"), str(file)], check=True)
