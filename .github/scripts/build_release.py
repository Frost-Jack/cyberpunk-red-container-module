"""Validate the Foundry manifest and build the two GitHub release assets."""

import json
import os
from pathlib import Path
import re
from zipfile import ZipFile, ZIP_DEFLATED


root = Path(__file__).resolve().parents[2]
manifest = json.loads((root / "module.json").read_text(encoding="utf-8"))
tag = os.environ.get("RELEASE_TAG", f"v{manifest['version']}")
repository = os.environ.get("GITHUB_REPOSITORY", "Frost-Jack/cyberpunk-red-container-module")

if not re.fullmatch(r"v?\d+\.\d+(?:\.\d+)?", tag):
    raise SystemExit(f"Unsupported release tag: {tag!r}. Use v1.0 or 1.0.")
if tag.removeprefix("v") != manifest["version"]:
    raise SystemExit(f"Tag {tag!r} does not match manifest version {manifest['version']!r}.")
if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
    raise SystemExit("Invalid GitHub repository name.")

url = f"https://github.com/{repository}"
manifest.update({
    "url": url,
    "manifest": f"{url}/releases/latest/download/module.json",
    "download": f"{url}/releases/download/{tag}/module.zip",
    "bugs": f"{url}/issues",
    "changelog": f"{url}/releases/tag/{tag}",
})

files = [root / name for name in ("README.md", "REVIEW.md", "LICENSE")]
for folder in ("scripts", "styles", "languages", "templates"):
    files.extend(path for path in (root / folder).rglob("*") if path.is_file())
paths = {path.relative_to(root).as_posix() for path in files}
required = [manifest["license"], manifest["readme"]]
for key in ("esmodules", "scripts", "styles"):
    required.extend(manifest.get(key, []))
for language in manifest.get("languages", []):
    required.append(language["path"])
    json.loads((root / language["path"]).read_text(encoding="utf-8"))
for path in required:
    if path not in paths or not (root / path).is_file():
        raise SystemExit(f"Manifest file is missing from the package: {path}")

output = root / "dist"
output.mkdir(exist_ok=True)
serialized = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
(output / "module.json").write_text(serialized, encoding="utf-8")
with ZipFile(output / "module.zip", "w", ZIP_DEFLATED) as archive:
    archive.writestr("module.json", serialized)
    for path in sorted(files):
        archive.write(path, path.relative_to(root).as_posix())
with ZipFile(output / "module.zip") as archive:
    if archive.testzip() is not None:
        raise SystemExit("Archive integrity check failed.")
    if archive.read("module.json").decode("utf-8") != serialized:
        raise SystemExit("Packaged manifest does not match the release asset.")
print(f"Built {manifest['id']} {manifest['version']} ({tag}): {len(files) + 1} files in dist/module.zip")
