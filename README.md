# Dino Walks Manhattan

A tiny third-person demo: a low-poly dinosaur with a Blender-made gun strolls (and shoots on) a stylized Manhattan intersection. Character, enemy, gun, and city meshes are **generated in Blender** and loaded in Vite + TypeScript + Three.js.

## Play

```bash
npm install
npm run dev
```

Open the printed localhost URL. Production build:

```bash
npm run build
```

Static output lands in `dist/` (Vercel-ready; no backend).

## Controls

- **Click canvas:** pointer-lock mouse look (Esc releases).
- **Mouse:** yaw/pitch the third-person camera. The dino’s yaw **always** matches the camera’s flat forward (look left → dino turns left).
- **W / S:** walk along camera flat forward / back.
- **A / D:** **strafe** left / right on screen (A left, D right). They never yaw the dino; yaw comes only from the mouse/camera.
- **Shift:** sprint. **LMB** (while locked): fire a visible bolt along camera-forward. Enemy shots are slow enough to sidestep.

## Combat

One rust-colored enemy dino patrols the block, faces you, and returns fire when you are in range with line of sight. Both have HP. Enemy down → **BLOCK CLEARED**. You down → restart.

## Asset pipeline (Blender)

Install the official Linux tarball from [blender.org](https://download.blender.org/release/) and put `blender` on your `PATH`. This repo was generated with **Blender 5.2.0 LTS**.

```bash
blender -b -P blender/generate_assets.py -- .
# or: npm run assets
```

| Script | Outputs |
| --- | --- |
| `blender/generate_assets.py` | `public/models/dino.glb` (green player + gun + walk), `public/models/enemy.glb` (rust dino + gun + walk), `public/models/manhattan.glb`, `public/models/collision.json`, `blender/dino_manhattan.blend` |

The dino rig is yawed 180° in Blender so the snout is **+Z** after glTF Y-up (travel-forward). Do not replace character/city/gun GLBs with Three.js `BoxGeometry` stand-ins. Runtime helpers are only lights, HP HUD, and shot bolts.
