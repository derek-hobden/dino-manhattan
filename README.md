# Dino Walks Manhattan

A tiny third-person demo: a low-poly dinosaur strolls a stylized Manhattan intersection. Character and city meshes are **generated in Blender** (headless Python) and loaded in a Vite + TypeScript + Three.js client.

## Play

```bash
npm install
npm run dev
```

Open the printed localhost URL. Production build:

```bash
npm run build
```

Static output lands in `dist/` (Vercel-ready; do not need a backend).

## Player controls

**WASD** or **arrow keys** walk relative to the camera. The dino turns toward the move direction while a third-person camera follows. **Shift** sprints (faster gait). Buildings, the cab, hydrants, subway kiosk, and newsstand block you; you stay on the street/sidewalk inside the block bounds.

## Asset pipeline (Blender)

Install the official Linux tarball from [blender.org](https://download.blender.org/release/) and put `blender` on your `PATH`. This repo was generated with **Blender 5.2.0 LTS**.

Regenerate GLBs, collision sidecar, and the source `.blend`:

```bash
blender -b -P blender/generate_assets.py -- .
```

or:

```bash
npm run assets
# same as: bash blender/export.sh
```

| Script | Outputs |
| --- | --- |
| `blender/generate_assets.py` | `public/models/dino.glb` (walk-cycle hierarchy), `public/models/manhattan.glb` (block + brownstones + deco tower + cab), `public/models/collision.json`, `blender/dino_manhattan.blend` |

Do not replace the GLBs with Three.js `BoxGeometry` stand-ins. Primitive helpers in the game are only for lights and runtime collision volumes derived from the loaded city.

## Layout

```
blender/generate_assets.py   # headless generator
blender/dino_manhattan.blend # last generated source scene
blender/export.sh
public/models/*.glb
src/main.ts                  # Three.js loader, camera, WASD, collision
```
