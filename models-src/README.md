# Frame generator (Blender)

Builds every glasses model from `frames.json` using Blender in headless mode. Output
follows [`docs/MODEL_SPEC.md`](../docs/MODEL_SPEC.md).

## One-time setup
Blender 5.x installed at the default path, then install shapely into a local folder:
```powershell
& "C:\Program Files\Blender Foundation\Blender 5.3\5.3\python\bin\python.exe" -m pip install --target models-src/.pydeps shapely
```

## Build
```powershell
& "C:\Program Files\Blender Foundation\Blender 5.3\blender.exe" --background --factory-startup --python models-src/build_frames.py
```
Options after `--`: `--only rowan,sky` (model or variant ids), `--no-render`, `--no-draco`, `--samples 64`.

Contact sheet of all previews → `docs/model-previews.png`:
```powershell
& "C:\Program Files\Blender Foundation\Blender 5.3\blender.exe" --background --factory-startup --python models-src/contact_sheet.py
```

## Outputs (`public/models/`)
- `frames/<model>-<s|m|l>.glb` – one file per model and size (Draco compressed)
- `frames/catalog.json` – dimensions (ISO 8624 boxed), finishes, face-shape tags
- `previews/<model>.png` – catalog thumbnails (size M)
- `textures/tex_*.jpg` – tortoiseshell textures, for re-colouring in the app
- `finishes.json` – finish/lens presets shared with the web app

## Adding a model
Add an entry to `frames.json`. The fields are:
- `construction`: `acetate`, `metal` or `combo`
- `shape`: superellipse exponents `n_top`/`n_bottom`, plus optional `upsweep` (cat-eye), `droop` (aviator), `flat_top` and `top_tilt`, or `{"kind": "polygon", "sides": 6}`
- `dims`: size M in mm (S and L are derived from `size_deltas`)
- `finishes`: keys from `lib/materials.py`

## Code
- `lib/shapes.py`: 2D lens outlines and front profiles (shapely)
- `lib/builders.py`: meshes (extrusion, lenses, sweeps)
- `lib/metal.py`: wire and browline frames
- `lib/parts.py`: temples
- `lib/materials.py`: PBR finishes
- `lib/render.py`: previews
