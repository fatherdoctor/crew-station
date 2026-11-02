# Tools

Run these from anywhere; paths are relative to the script. Scripts that make art write to `out/` in this folder and never
touch the page's tree. Copy results in by hand.

| Script | Needs | Status |
|---|---|---|
| `tools/sheets.py` | Python 3 standard library | Ready to run |
| `tools/prepare_crew_refs.py` | Python 3, Pillow | Needs Pillow |
| `tools/export_blocks.py` | Python 3, Pillow, NumPy | Needs Pillow and NumPy; add your own sources |
| `tools/export_props.py` | Python 3, Pillow, NumPy | Needs Pillow and NumPy; add your own source |

## sheets.py

```sh
python3 tools/sheets.py template [outdir]       # blank sheet grids and sheet-layouts.json
python3 tools/sheets.py check a|b|c FILE...     # canvas, alpha, feet on row 68, spare cells empty, no metadata
python3 tools/sheets.py atlas ATLAS.json        # same checks for an atlas and its images
python3 tools/sheets.py strip FILE...           # remove metadata chunks from PNG files, in place
```

It reads 8-bit, non-interlaced PNG only. `templates/` in this folder is its output. `check` and `atlas` measure placement,
not whether a figure looks right.

With the page's tree beside this folder:

```sh
python3 tools/sheets.py atlas ../crew-station/assets/sprites/atlas.json
```

Adjust the path to wherever the tree is.

`atlas` reports any cell whose feet are off row 68.

## prepare_crew_refs.py

Builds a 936 x 678 contact sheet per member from `crew-refs/`, to attach as an identity reference when generating a sheet.
Writes `out/crew-ref-sheets/<member>-references.png`.

## export_blocks.py

Fits generated block art to the shared 64 x 48 silhouette: maps each cube face, reduces the palette, restores amber accents,
draws window lamps and the roof beacon, and writes the ghost as exact wire geometry. Then it checks sizes and alpha.

**Missing:** one generated image per block at `tools/sources/<name>.png`, for the nine names in `tools/blocks-prompts.json`.
None ship. The prompts file holds the text used for each. Their "reference room" wording assumed a room image attached for
style; attach your own.

Face depths in the script suit the original images, so expect to adjust them for new ones. Writes `out/blocks/`.

## export_props.py

Cuts a 5 x 5 generated atlas into the 160 x 112 items atlas and its JSON, scaling items to 14 px inside 16 px cells and
effects to fit 32 px cells.

**Missing:** the generated atlas at `tools/sources/items-source.png`. None ships. Its contents, in row order: mug full, mug
empty, closed book, open book, folder; small crate, watering can, wrench, hammer, parcel; steam 1-3, sparks 1-2; sparks 3,
water mist 1-3, page flip 1; page flip 2, then four empty cells. Writes `out/props/`.

## Not included

There is no script here for a finished sprite sheet or room shell. The steps are in [ART-GUIDE.md](ART-GUIDE.md). Do not
take the figure's shape from a per-cell outline fit, for the reasons given there.
