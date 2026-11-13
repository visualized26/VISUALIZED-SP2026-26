# VISUALIZED – 3D Frame Model Spec (v1)

Every glasses model used by the web app follows this contract, so the try-on
renderer, customization and Smart Fit Analysis can treat all frames the same way.
Models are produced by the Blender generator in `models-src/` — do not hand-edit
the exported `.glb` files; change `models-src/frames.json` and rebuild.

## File & format
- Format: binary glTF 2.0 (`.glb`), one file per frame variant:
  `public/models/frames/<id>.glb`
- Optional Draco mesh compression (`KHR_draco_mesh_compression`).
- Budget: ≤ 60k triangles and ≤ 1.5 MB per file (after compression).
- Preview images: `public/models/previews/<id>.png` (3/4 view, transparent bg).
- Catalog index: `public/models/frames/catalog.json` (generated).

## Units & axes (glTF space)
- 1 unit = 1 metre (glTF standard). All measurements in metadata are in **mm**.
- **+Y up**, **+Z points forward** (out of the wearer's face, toward the camera),
  **+X = wearer's LEFT** (viewer's right when facing the wearer).
- Suffix `_L` / `_R` always means the **wearer's** left / right.

## Origin
- **X = 0**: midway between the two lens box centres (centre of the bridge).
- **Y = 0**: the datum line (horizontal line through both lens box centres).
- **Z = 0**: back surface of the frame front at the bridge.
- The front is vertical in the file. Pantoscopic tilt and face-form wrap are
  baked in as the *angles between the front and the temples* (as a real frame
  sitting on a table); the app tilts the whole model to match head pose.

## Node hierarchy
```
Frame                (root, empty, origin as above; extras = metadata)
├── Front            mesh – rims, bridge, end pieces, hinge barrels, rivets
├── Lens_L, Lens_R   mesh – lenses (separate so tint/shape can change)
├── NosePads         mesh – optional (metal frames)
├── Temple_L         mesh – object origin = hinge pivot (rotate about Y to splay/fold)
├── Temple_R
└── Anchor_Bridge    empty – point where the frame rests on the nose bridge
```

## Material slots (names are fixed – the app looks them up by name)
| Material | Used for | App may change |
|---|---|---|
| `frame`  | front body (acetate / metal rim) | colour, texture, roughness |
| `temple` | temple arms | colour (two-tone) |
| `metal`  | hinges, rivets, wire parts, bridge on metal frames | metal finish |
| `tip`    | temple tips / ear sleeves | colour |
| `pad`    | nose pads | – |
| `lens`   | lenses | tint colour, transmission, mirror |

PBR via `KHR_materials_transmission`, `KHR_materials_ior`,
`KHR_materials_clearcoat` where useful. Textures (e.g. tortoiseshell) are
embedded in the GLB and use planar UVs on the front.

## Metadata (`Frame` node extras and `catalog.json` entry)
```json
{
  "id": "rect-acetate-black-m",
  "name": "Rowan",
  "style": "rectangle",          // round | square | rectangle | cat-eye | aviator | browline | geometric | oval
  "construction": "acetate",     // acetate | metal | combo | rimless
  "size": "M",                   // S | M | L
  "finish": "Onyx Black",
  "dims_mm": {
    "lens_width": 52,            // ISO 8624 boxed horizontal lens size (a)
    "lens_height": 40,           // boxed vertical lens size (b)
    "bridge": 18,                // distance between lenses (DBL)
    "temple_length": 145,
    "total_width": 138,          // overall front width incl. end pieces
    "frame_pd": 70               // a + DBL, distance between box centres
  },
  "angles_deg": { "pantoscopic": 8, "wrap": 5 },
  "face_shapes": ["round", "oval"],  // recommended for (used by recommendations)
  "triangles": 31234
}
```
