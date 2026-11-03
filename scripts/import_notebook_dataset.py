"""Import notebook metadata privately, then produce opaque PNGs and a D1 seed file."""

import argparse, csv, json, shutil, subprocess, sys, uuid
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--metadata", type=Path, required=True)
p.add_argument("--project", type=Path, default=Path(__file__).resolve().parent.parent)
a = p.parse_args()
project = a.project.resolve()
metadata = a.metadata.resolve()
folder = project / "data/imports" / uuid.uuid4().hex
folder.mkdir(parents=True)
items = []
with metadata.open(newline="", encoding="utf-8") as file:
    for row in csv.DictReader(file):
        dataset = {"fashion_mnist": "fashion"}.get(row["dataset"], row["dataset"])
        label = (
            row["label"]
            if dataset == "mnist"
            else row.get("label_name", row["label"]).replace("_", " ")
        )
        if dataset == "mnist" and label == "0":
            continue
        src = Path(row["image_path"])
        if not src.is_absolute():
            suffixes = [src]
            if src.parts and src.parts[0] == "generated_constellations":
                suffixes.append(Path(*src.parts[1:]))
            candidates = [
                Path.cwd() / src,
                *[
                    prefix / suffix
                    for prefix in [
                        metadata.parent,
                        metadata.parent.parent,
                        metadata.parent.parent.parent,
                    ]
                    for suffix in suffixes
                ],
            ]
            src = next((candidate for candidate in candidates if candidate.is_file()), src)
        if not src.is_file():
            raise FileNotFoundError(src)
        if src.suffix.lower() != ".png":
            raise ValueError("Notebook images must be PNG files")
        name = uuid.uuid4().hex + ".png"
        shutil.copy2(src, folder / name)
        items.append(
            dict(
                image=name,
                dataset=dataset,
                label=label,
                difficulty=int(row["difficulty"]),
                source_index=row["source_index"],
                metadata={
                    k: v for k, v in row.items() if k not in ["image_path", "coordinates_path"]
                },
            )
        )
manifest = folder / "manifest.json"
manifest.write_text(json.dumps(dict(source="notebook-generated", items=items), indent=2))
subprocess.run(
    [sys.executable, str(project / "scripts/prepare-stimuli.py"), str(manifest)], check=True
)
print(
    "Next: npm run build, then apply data/seed.sql to the appropriate local or remote D1 database."
)
