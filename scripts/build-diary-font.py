#!/usr/bin/env python3
"""Build offline, disjoint Maiyuan WOFF2 slices and atomically publish their CSS.

Requires fonttools[woff] (including Brotli). No downloads or font installation.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile


ROOT = Path(__file__).resolve().parent.parent
SOURCE_SHA256 = "94ea78c51086b1ea58c1744784b2335dea2c5ef1c5193b80e02c7d46b8e0283f"
SOURCE_URL = "https://raw.githubusercontent.com/maoken-fonts/KNMaiyuan/main/fonts/TTF/KNMaiyuan-Regular.ttf"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def font_modules(tools_path: str | None):
    if tools_path and tools_path not in sys.path:
        sys.path.insert(0, tools_path)
    import fontTools
    from fontTools import subset
    from fontTools.ttLib import TTFont
    return fontTools, subset, TTFont


def cmap_points(font) -> set[int]:
    # Include every Unicode cmap, not just getBestCmap().
    return set().union(*(set(getattr(table, "cmap", {}))
                         for table in font["cmap"].tables if table.isUnicode()))


def parse_ranges(spec: str) -> set[int]:
    points: set[int] = set()
    for token in spec.split(","):
        match = re.fullmatch(r"\s*U\+([0-9a-f]+)(?:-([0-9a-f]+))?\s*", token, re.I)
        if not match:
            raise ValueError(f"Unsupported unicode-range token: {token!r}")
        lo = int(match[1], 16)
        hi = int(match[2] or match[1], 16)
        if not 0 <= lo <= hi <= 0x10FFFF:
            raise ValueError(f"Invalid Unicode range: {token!r}")
        points.update(range(lo, hi + 1))
    return points


def css_ranges(points: set[int]) -> str:
    ordered = sorted(points)
    result: list[str] = []
    start = end = ordered[0]
    for cp in ordered[1:]:
        if cp == end + 1:
            end = cp
        else:
            result.append(f"U+{start:04X}" if start == end else f"U+{start:04X}-{end:04X}")
            start = end = cp
    result.append(f"U+{start:04X}" if start == end else f"U+{start:04X}-{end:04X}")
    return ",".join(result)


def make_buckets(plan: str, source_points: set[int], extra_size: int):
    buckets: list[tuple[str, set[int]]] = []
    assigned: set[int] = set()
    for index, body in enumerate(re.findall(r"@font-face\s*\{([^}]+)\}", plan), 1):
        match = re.search(r"unicode-range\s*:\s*([^;}]+)", body, re.I)
        if not match:
            raise ValueError("A range-plan face has no unicode-range")
        relevant = parse_ranges(match[1]) & source_points
        if relevant & assigned:
            raise ValueError("Range plan overlaps for source characters")
        if relevant:
            buckets.append((f"plan-{index:03d}", relevant))
            assigned.update(relevant)
    if not buckets:
        raise ValueError("The range plan covers no source characters")
    remaining = sorted(source_points - assigned)
    for start in range(0, len(remaining), extra_size):
        buckets.append((f"extra-{start // extra_size + 1:03d}", set(remaining[start:start + extra_size])))
    return buckets


def build_slice(job):
    source, tools_path, staging, label, codepoints = job
    _, subset, TTFont = font_modules(tools_path)
    expected = set(codepoints)
    options = subset.Options()
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.name_legacy = True
    options.layout_features = ["*"]
    options.hinting = True
    options.notdef_outline = True
    options.recommended_glyphs = True
    font = TTFont(source, recalcTimestamp=False)
    cutter = subset.Subsetter(options=options)
    cutter.populate(unicodes=expected)
    cutter.subset(font)
    # Layout closure can retain additional aliases of an already-kept glyph.
    # Keep those outlines but publish their cmap entries only in their own slice.
    for table in font["cmap"].tables:
        if table.isUnicode() and hasattr(table, "cmap"):
            table.cmap = {cp: glyph for cp, glyph in table.cmap.items() if cp in expected}
    font.flavor = "woff2"
    temporary = Path(staging) / f"{label}.woff2"
    font.save(temporary)
    font.close()
    with TTFont(temporary, recalcTimestamp=False) as result:
        actual = cmap_points(result)
        if actual != expected:
            raise ValueError(f"{label}: cmap mismatch; missing {len(expected - actual)}, extra {len(actual - expected)}")
        if result["OS/2"].usWeightClass != 400:
            raise ValueError(f"{label}: native Regular weight changed")
        if not result["name"].getDebugName(0):
            raise ValueError(f"{label}: copyright metadata lost")
    checksum = digest(temporary)
    filename = f"kn-maiyuan-regular-{label}-{checksum[:12]}.woff2"
    temporary.rename(Path(staging) / filename)
    return {"label": label, "file": filename, "bytes": temporary.with_name(filename).stat().st_size,
            "sha256": checksum, "characters": len(expected), "unicodeRange": css_ranges(expected)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Original KNMaiyuan-Regular.ttf v1.20")
    parser.add_argument("--output", type=Path, default=ROOT / "public/fonts/maiyuan")
    parser.add_argument("--range-plan", type=Path, default=ROOT / "public/fonts/wenkai/regular.css")
    parser.add_argument("--plan-license", type=Path, default=ROOT / "public/fonts/wenkai/WEBFONT-LICENSE.txt")
    parser.add_argument("--tools-path", type=Path, help="Optional directory containing fontTools and Brotli")
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--extra-size", type=int, default=256, help="Maximum source cmap characters per additional slice")
    args = parser.parse_args()
    if args.workers < 1 or args.extra_size < 1:
        parser.error("workers and extra-size must be positive")
    source, output = args.source.resolve(), args.output.resolve()
    if digest(source) != SOURCE_SHA256:
        raise ValueError("Source SHA256 does not match the pinned Maiyuan v1.20 original")
    if not (output / "OFL.txt").is_file():
        raise ValueError("Keep the original font OFL.txt in the output directory before building")
    tools_path = str(args.tools_path.resolve()) if args.tools_path else None
    fontTools, _, TTFont = font_modules(tools_path)
    with TTFont(source, recalcTimestamp=False) as original:
        source_points = cmap_points(original)
        copyright_text = original["name"].getDebugName(0)
        version = original["name"].getDebugName(5)
    plan = args.range_plan.read_text(encoding="utf-8")
    buckets = make_buckets(plan, source_points, args.extra_size)
    staging = Path(tempfile.mkdtemp(prefix=".maiyuan-build-", dir=output)).resolve()
    if staging.parent != output:
        raise ValueError("Staging directory is outside the requested font directory")
    try:
        jobs = [(str(source), tools_path, str(staging), label, sorted(points)) for label, points in buckets]
        if args.workers == 1:
            entries = list(map(build_slice, jobs))
        else:
            with ProcessPoolExecutor(max_workers=args.workers) as pool:
                entries = list(pool.map(build_slice, jobs))
        seen: set[int] = set()
        for entry in entries:
            points = parse_ranges(entry["unicodeRange"])
            if points & seen:
                raise ValueError("Generated CSS ranges overlap")
            seen.update(points)
        if seen != source_points:
            raise ValueError("Generated CSS does not cover the complete source Unicode cmap")
        css = "/* Generated by scripts/build-diary-font.py. Range plan: Chawye Hsu, MIT; font: OFL-1.1. */\n"
        for entry in entries:
            css += (f"/* {entry['label']}: {entry['characters']} Unicode characters */\n"
                    "@font-face {\n  font-family: 'KN Maiyuan';\n  font-style: normal;\n"
                    "  font-weight: 400;\n  font-display: swap;\n"
                    f"  src: url('./files/{entry['file']}') format('woff2');\n"
                    f"  unicode-range: {entry['unicodeRange']};\n}}\n")
        summary = {"fontFamily": "KN Maiyuan", "fontVersion": version, "sourceSha256": SOURCE_SHA256,
                   "sourceUrl": SOURCE_URL, "copyright": copyright_text, "fontToolsVersion": fontTools.__version__,
                   "rangePlanSha256": digest(args.range_plan), "unicodeCharacters": len(source_points),
                   "plannedSlices": sum(e["label"].startswith("plan-") for e in entries),
                   "extraSlices": sum(e["label"].startswith("extra-") for e in entries),
                   "files": len(entries), "woff2Bytes": sum(e["bytes"] for e in entries),
                   "overlappingCharacters": 0, "missingCharacters": 0, "slices": entries}
        (staging / "regular.css").write_text(css, encoding="utf-8", newline="\n")
        (staging / "manifest.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        shutil.copyfile(args.plan_license, staging / "RANGE-PLAN-LICENSE.txt")
        readme = f"""# 荆南麦圆体 / KN Maiyuan

Original Regular v1.20 (native weight 400), by Kingnam Type Foundry.\n
{copyright_text}

- Author-authorized upstream: https://github.com/maoken-fonts/KNMaiyuan
- Original TTF: {SOURCE_URL}
- Source SHA256: `{SOURCE_SHA256}`
- Font license: [SIL OFL 1.1](OFL.txt). Copyright and all original name metadata remain embedded in each slice.
- Range-plan source: `lxgw-wenkai-webfont@1.7.0` Regular CSS, https://github.com/chawyehsu/lxgw-wenkai-webfont
- Range-plan license: [MIT, Chawye Hsu](RANGE-PLAN-LICENSE.txt). No WenKai glyphs are used.

## Offline build and verification

```powershell
python scripts/build-diary-font.py work/round-font-source/KNMaiyuan-Regular.ttf --tools-path work/round-font-tools
```

Alternatively, install FontTools with Brotli in the Python environment and omit `--tools-path`.
The generator performs no network requests. It checks the pinned source SHA256,
intersects the existing WenKai Unicode slicing plan with **all** source Unicode
cmap tables, and splits additional characters into at most {args.extra_size}-character
chunks. Empty planned slices are omitted. FontTools {fontTools.__version__} retains
native outlines, hinting, weight 400, layout feature closure and original name
metadata; only glyph subsetting and WOFF2 conversion are applied. No synthetic
weight or extra outline stroke is applied.

Each resulting WOFF2 is reopened to verify its exact cmap and metadata. The
generated CSS ranges have no overlaps and no missing source cmap characters.
New content-addressed files are installed before `regular.css` is atomically
replaced, so a failed generation leaves the previous stylesheet usable.

This build: **{len(source_points):,} Unicode cmap characters**, **{len(entries)} WOFF2 slices**,
**{summary['woff2Bytes']:,} WOFF2 bytes**. Full details and SHA256 values are in
[`manifest.json`](manifest.json). These are Unicode mapping counts, not a claim
about complete coverage of every Chinese standard or every possible user input.

The browser loads only slices whose `unicode-range` matches displayed text.
`font-display: swap` retains readable fallback during loading. Unmapped
characters continue through the CSS reading fallback stack. All runtime font
assets are self-hosted. A prior full WOFF2, if present, is not referenced by the
generated stylesheet and can be retained separately for rollback.
"""
        (staging / "README.md").write_text(readme, encoding="utf-8", newline="\n")
        (output / "files").mkdir(exist_ok=True)
        for entry in entries:
            os.replace(staging / entry["file"], output / "files" / entry["file"])
        for name in ["manifest.json", "RANGE-PLAN-LICENSE.txt", "README.md"]:
            os.replace(staging / name, output / name)
        # Publish last: references only validated, fully installed font files.
        os.replace(staging / "regular.css", output / "regular.css")
        print(json.dumps({key: value for key, value in summary.items() if key != "slices"}, ensure_ascii=False))
    finally:
        # Only delete this process's verified staging directory, never output.
        if staging.parent == output and staging.name.startswith(".maiyuan-build-"):
            shutil.rmtree(staging)


if __name__ == "__main__":
    main()
