"""Replace the third study block with a private Quickdraw constellation collection."""

import argparse
import csv
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("folder", type=Path, help="Quickdraw folder containing metadata.csv")
args = parser.parse_args()
folder = args.folder.resolve()
db = sqlite3.connect(":memory:")
db.row_factory = sqlite3.Row
for migration in sorted((root / "migrations").glob("*.sql")):
    db.executescript(migration.read_text())
db.executescript((root / "data/seed.sql").read_text())
items = []
for row in db.execute("SELECT * FROM stimuli WHERE active=1 AND dataset IN ('mnist','fashion')"):
    items.append(
        dict(
            image=str(root / "public" / row["image_path"].lstrip("/")),
            dataset=row["dataset"],
            label=row["label"],
            difficulty=row["difficulty"],
            source_index=row["source_index"],
            metadata=json.loads(row["metadata_json"]),
        )
    )
if {item["dataset"] for item in items} != {"mnist", "fashion"}:
    raise SystemExit("Import the existing MNIST and FashionMNIST collection first.")
with (folder / "metadata.csv").open(newline="", encoding="utf-8") as file:
    for row in csv.DictReader(file):
        if row["dataset"] != "quickdraw":
            raise ValueError("Expected Quickdraw metadata")
        path = Path(row["image_path"])
        if path.is_absolute():
            source = path
        else:
            source = folder / path.relative_to("generated_constellations/quickdraw")
        if not source.is_file():
            raise FileNotFoundError(source)
        items.append(
            dict(
                image=str(source),
                dataset="quickdraw",
                label=row["label_name"].replace("_", " "),
                difficulty=int(row["difficulty"]),
                # Source indices are class-local in Quickdraw. Keep each original unique.
                source_index=row["label_name"] + ":" + row["source_index"],
                metadata={
                    key: value
                    for key, value in row.items()
                    if key not in ("image_path", "coordinates_path")
                },
            )
        )
manifest = root / "data/quickdraw-study-manifest.json"
manifest.write_text(json.dumps(dict(source="notebook-generated", items=items), indent=2))
subprocess.run(
    [sys.executable, str(root / "scripts/prepare-stimuli.py"), str(manifest)], check=True
)
print("Prepared MNIST, FashionMNIST and Quickdraw. Run npm run setup:local to update local D1.")
