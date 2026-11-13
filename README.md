# VISUALIZED – Intelligent Eyewear Try-On

Senior project SP2026-26, Faculty of ICT, Mahidol University.

**Live site:** https://visualized26.github.io/VISUALIZED-SP2026-26/

Try on realistic 3D glasses in the browser with a webcam or a photo. The frames
appear at their real millimetre size, and the site estimates face measurements to
help you choose. Everything runs on your device: camera images are never uploaded.

## Status
- [x] 3D frame collection: 14 designs × S/M/L, generated in Blender (`models-src/`)
- [x] Real-time try-on: MediaPipe Face Landmarker and Three.js, with smoothing,
  temple occlusion and contact shadows
- [x] Photo mode, frame/lens customisation, fit adjustments, favourites
- [x] Face-shape detection (6 shapes, with confidence) and frame recommendations
- [ ] Full Smart Fit Analysis
- [ ] Frame comparison
- [x] Multi-angle capture and Gallery (sets of 3, downloadable lookbook)
- [ ] RimlessCut
- [ ] UI design phase

## Run locally
Requires Node.js 20+.
```bash
npm install
npm run dev
```
Open http://localhost:5173. Webcams only work on `localhost` or HTTPS.

## Project layout
- `src/core/`: the engine (camera, face tracking, pose, renderer, catalog). It has no DOM/UI code.
- `src/ui/`, `src/styles/`: the interface, which can be replaced without touching the core.
- `models-src/`: Blender generator for the 3D frames. See [models-src/README.md](models-src/README.md).
- `public/models/`: generated models, previews, textures and catalog.
- `docs/MODEL_SPEC.md`: the contract every 3D model follows.

## Deploy
Every push to `main` builds the site and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`).

Measurements are estimates from a webcam and are not a substitute for a professional
optical measurement.
