"""Private manifest -> opaque public PNG assets + private D1 seed SQL (never deploy data/)."""

import argparse, hashlib, json, re
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("manifest", type=Path)
a = p.parse_args()
root = Path(__file__).resolve().parent.parent
manifest = json.loads(a.manifest.read_text())
output = root / "public/stimuli"
output.mkdir(parents=True, exist_ok=True)
items = []
assets = {}
sql = [
    "-- PRIVATE answer key. Apply to D1; never serve this file.",
    "BEGIN TRANSACTION;",
    "UPDATE stimuli SET active=0;",
]
quote = lambda s: "'" + str(s).replace("'", "''") + "'"
seen = set()
for item in manifest["items"]:
    dataset = item["dataset"]
    label = str(item["label"])
    difficulty = int(item["difficulty"])
    source = str(item["source_index"])
    if dataset == "mnist" and label not in list("123456789"):
        continue
    key = (dataset, difficulty, source)
    if key in seen:
        raise ValueError(f"Duplicate source in a condition: {key}")
    seen.add(key)
    src = (a.manifest.parent / item["image"]).resolve()
    if src.suffix.lower() != ".png":
        raise ValueError("Import raster PNG files only; remove metadata first.")
    raw = src.read_bytes()
    # Strip ancillary PNG chunks, including textual labels, EXIF, and time metadata.
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Not a PNG")
    clean = raw[:8]
    offset = 8
    ended = False
    while offset < len(raw):
        length = int.from_bytes(raw[offset : offset + 4], "big")
        chunk = raw[offset + 4 : offset + 8]
        end = offset + 12 + length
        if end > len(raw):
            raise ValueError("Truncated PNG")
        if chunk in (b"IHDR", b"PLTE", b"IDAT", b"IEND", b"tRNS"):
            clean += raw[offset:end]
        offset = end
        if chunk == b"IEND":
            ended = True
            break
    if not ended:
        raise ValueError("Missing PNG end marker")
    # Content hash is opaque with respect to the label and stable across repeated imports.
    sid = hashlib.sha256(clean).hexdigest()[:32]
    path = "/stimuli/" + sid + ".png"
    assets[sid + ".png"] = clean
    if any(i["id"] == sid for i in items):
        raise ValueError("Duplicate image content; use independent stimuli")
    row = dict(item, id=sid, image=path)
    items.append(row)
    values = [
        sid,
        path,
        dataset,
        difficulty,
        label,
        source,
        manifest.get("source", "notebook-generated"),
        json.dumps(item.get("metadata", {}), separators=(",", ":")),
    ]
    sql.append(
        "INSERT INTO stimuli(id,image_path,dataset,difficulty,label,source_index,stimulus_source,metadata_json) VALUES("
        + ",".join(map(quote, values))
        + ") ON CONFLICT(id) DO UPDATE SET active=1,metadata_json=excluded.metadata_json;"
    )
sql += ["COMMIT;"]
for name, content in assets.items():
    (output / name).write_bytes(content)
(root / "data/seed.sql").write_text("\n".join(sql) + "\n")
# Remove obsolete public assets, including the old label-bearing manifest and filenames.
keep = {i["image"].split("/")[-1] for i in items}
for f in output.iterdir():
    if f.is_file() and f.name not in keep and not re.fullmatch(r"[0-9a-f]{32}\.png", f.name):
        f.unlink()
print(f"Prepared {len(items)} opaque images; private answer key: data/seed.sql")
