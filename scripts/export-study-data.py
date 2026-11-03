"""Package the prepared stimulus collection, without participant data or credentials."""

import argparse
import json
import sqlite3
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, default=root / "data/study-dataset.zip")
args = parser.parse_args()
seed = root / "data/seed.sql"
if not seed.is_file():
    raise SystemExit("Import the study collection before exporting it.")
db = sqlite3.connect(":memory:")
db.row_factory = sqlite3.Row
for migration in sorted((root / "migrations").glob("*.sql")):
    db.executescript(migration.read_text())
db.executescript(seed.read_text())
rows = db.execute("SELECT * FROM stimuli WHERE active=1 ORDER BY dataset,difficulty,id").fetchall()
if not rows:
    raise SystemExit("The prepared collection has no active images.")
sources = {row["stimulus_source"] for row in rows}
if len(sources) != 1:
    raise SystemExit("Export a collection with one documented stimulus source.")
items = []
args.output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED) as archive:
    for row in rows:
        file = root / "public" / row["image_path"].lstrip("/")
        target = "images/" + file.name
        archive.write(file, target)
        items.append(
            dict(
                image=target,
                dataset=row["dataset"],
                label=row["label"],
                difficulty=row["difficulty"],
                source_index=row["source_index"],
                metadata=json.loads(row["metadata_json"]),
            )
        )
    archive.writestr(
        "manifest.json", json.dumps(dict(source=next(iter(sources)), items=items), indent=2)
    )
args.output.chmod(0o600)
print(f"Exported {len(items)} study images and the private answer key to {args.output}")
print(
    "Share with the development team, not study respondents. No participant responses are included."
)
