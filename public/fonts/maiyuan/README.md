# 荆南麦圆体 / KN Maiyuan

Original Regular v1.20 (native weight 400), by Kingnam Type Foundry.

Copyright 2020-2022 The Maiyuan Project Authors (https://github.com/NightFurySL2001/KNMaiyuan)

- Author-authorized upstream: https://github.com/maoken-fonts/KNMaiyuan
- Original TTF: https://raw.githubusercontent.com/maoken-fonts/KNMaiyuan/main/fonts/TTF/KNMaiyuan-Regular.ttf
- Source SHA256: `94ea78c51086b1ea58c1744784b2335dea2c5ef1c5193b80e02c7d46b8e0283f`
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
cmap tables, and splits additional characters into at most 256-character
chunks. Empty planned slices are omitted. FontTools 4.68.0 retains
native outlines, hinting, weight 400, layout feature closure and original name
metadata; only glyph subsetting and WOFF2 conversion are applied. No synthetic
weight or extra outline stroke is applied.

Each resulting WOFF2 is reopened to verify its exact cmap and metadata. The
generated CSS ranges have no overlaps and no missing source cmap characters.
New content-addressed files are installed before `regular.css` is atomically
replaced, so a failed generation leaves the previous stylesheet usable.

This build: **17,491 Unicode cmap characters**, **118 WOFF2 slices**,
**4,196,348 WOFF2 bytes**. Full details and SHA256 values are in
[`manifest.json`](manifest.json). These are Unicode mapping counts, not a claim
about complete coverage of every Chinese standard or every possible user input.

The browser loads only slices whose `unicode-range` matches displayed text.
`font-display: swap` retains readable fallback during loading. Unmapped
characters continue through the CSS reading fallback stack. All runtime font
assets are self-hosted. A prior full WOFF2, if present, is not referenced by the
generated stylesheet and can be retained separately for rollback.
