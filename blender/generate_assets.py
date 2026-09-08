"""Headless Blender generator for the dino + Manhattan GLBs.

Usage:
  blender -b -P blender/generate_assets.py -- /path/to/repo
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Vector


def repo_root() -> Path:
    argv = sys.argv
    if "--" in argv:
        extra = argv[argv.index("--") + 1 :]
        if extra:
            return Path(extra[0]).resolve()
    return Path(__file__).resolve().parents[1]


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 24
    scene.frame_start = 1
    scene.frame_end = 24
    scene.unit_settings.system = "METRIC"


def mat(name: str, color: tuple[float, float, float], roughness: float = 0.62) -> bpy.types.Material:
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled:
        principled.inputs["Base Color"].default_value = (*color, 1.0)
        if "Roughness" in principled.inputs:
            principled.inputs["Roughness"].default_value = roughness
        if "Specular IOR Level" in principled.inputs:
            principled.inputs["Specular IOR Level"].default_value = 0.18
        elif "Specular" in principled.inputs:
            principled.inputs["Specular"].default_value = 0.18
    material.diffuse_color = (*color, 1.0)
    return material


def assign(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    if obj.data.materials:
        obj.data.materials[0] = material
    else:
        obj.data.materials.append(material)


def make_box(
    name: str,
    location: tuple[float, float, float],
    size: tuple[float, float, float],
    material: bpy.types.Material,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(obj, material)
    if parent:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def make_cylinder(
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    material: bpy.types.Material,
    vertices: int = 10,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name
    assign(obj, material)
    if parent:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def empty(
    name: str,
    location: tuple[float, float, float],
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    if parent:
        obj.parent = parent
    obj.location = location
    return obj


def make_box_local(
    name: str,
    local: tuple[float, float, float],
    size: tuple[float, float, float],
    material: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0.0, 0.0, 0.0))
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(obj, material)
    obj.parent = parent
    obj.location = local
    obj.rotation_euler = (0.0, 0.0, 0.0)
    return obj


def key_rot(obj: bpy.types.Object, frame: int, euler: tuple[float, float, float]) -> None:
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = Euler(euler)
    obj.keyframe_insert(data_path="rotation_euler", frame=frame)


def key_loc(obj: bpy.types.Object, frame: int, loc: tuple[float, float, float]) -> None:
    obj.location = loc
    obj.keyframe_insert(data_path="location", frame=frame)


def smooth_fcurves(obj: bpy.types.Object) -> None:
    if not obj.animation_data or not obj.animation_data.action:
        return
    action = obj.animation_data.action
    fcurves = getattr(action, "fcurves", None)
    if fcurves is None:
        # Blender 5.x slotted actions store fcurves on layers/strips.
        try:
            fcurves = []
            for layer in getattr(action, "layers", []):
                for strip in getattr(layer, "strips", []):
                    channelbag = getattr(strip, "channelbag", None)
                    if channelbag is None and hasattr(strip, "channelbags"):
                        for bag in strip.channelbags:
                            fcurves.extend(list(getattr(bag, "fcurves", [])))
                    elif channelbag is not None:
                        fcurves.extend(list(getattr(channelbag, "fcurves", [])))
        except Exception:
            return
    for fcurve in fcurves or []:
        for kp in fcurve.keyframe_points:
            kp.interpolation = "BEZIER"
            kp.handle_left_type = "AUTO_CLAMPED"
            kp.handle_right_type = "AUTO_CLAMPED"


def attach_gun(arm: bpy.types.Object, prefix: str) -> bpy.types.Object:
    steel = mat(f"{prefix}_gun_steel", (0.18, 0.19, 0.21), roughness=0.32)
    dark = mat(f"{prefix}_gun_dark", (0.06, 0.06, 0.07), roughness=0.45)
    wood = mat(f"{prefix}_gun_wood", (0.28, 0.16, 0.08), roughness=0.7)
    brass = mat(f"{prefix}_gun_brass", (0.72, 0.55, 0.18), roughness=0.28)
    gun = empty(f"{prefix}Gun", (0.12, 0.22, -0.02), arm)
    make_box_local(f"{prefix}GunReceiver", (0.0, 0.08, 0.0), (0.12, 0.42, 0.14), steel, gun)
    make_box_local(f"{prefix}GunBarrel", (0.0, 0.48, 0.02), (0.07, 0.55, 0.07), dark, gun)
    make_box_local(f"{prefix}GunGrip", (0.0, -0.06, -0.16), (0.1, 0.12, 0.22), wood, gun)
    make_box_local(f"{prefix}GunMag", (0.0, 0.06, -0.14), (0.08, 0.14, 0.18), dark, gun)
    make_box_local(f"{prefix}GunStock", (0.0, -0.22, 0.0), (0.1, 0.28, 0.12), wood, gun)
    make_box_local(f"{prefix}GunSight", (0.0, 0.18, 0.1), (0.04, 0.1, 0.06), brass, gun)
    muzzle = empty(f"{prefix}Muzzle", (0.0, 0.78, 0.02), gun)
    muzzle.empty_display_type = "SPHERE"
    muzzle.empty_display_size = 0.08
    return muzzle


def build_dino(
    prefix: str = "Dino",
    hide_color: tuple[float, float, float] = (0.34, 0.48, 0.22),
    belly_color: tuple[float, float, float] = (0.62, 0.58, 0.32),
    crest_color: tuple[float, float, float] = (0.55, 0.22, 0.14),
) -> bpy.types.Object:
    hide = mat(f"{prefix}_hide", hide_color)
    belly = mat(f"{prefix}_belly", belly_color)
    dark = mat(f"{prefix}_dark", (0.18, 0.22, 0.12))
    claw = mat(f"{prefix}_claw", (0.82, 0.78, 0.62))
    eye = mat(f"{prefix}_eye", (0.08, 0.08, 0.06), roughness=0.2)
    crest = mat(f"{prefix}_crest", crest_color)

    # Wrapper is identity in Three.js. Rig is yawed 180° so Blender +Y nose
    # becomes glTF +Z (travel-forward) after Y-up export.
    root = empty(prefix, (0.0, 0.0, 0.0))
    rig = empty(f"{prefix}Rig", (0.0, 0.0, 0.0), root)
    rig.rotation_euler = (0.0, 0.0, math.pi)
    hips = empty(f"{prefix}Hips", (0.0, 0.0, 1.15), rig)

    body = make_box_local(f"{prefix}Body", (0.0, 0.12, 0.13), (0.72, 1.15, 0.62), hide, hips)
    make_box_local(f"{prefix}Belly", (0.0, 0.08, -0.10), (0.48, 0.9, 0.28), belly, hips)

    neck = empty(f"{prefix}Neck", (0.0, 0.72, 0.40), hips)
    make_box_local(f"{prefix}NeckMesh", (0.0, 0.06, 0.03), (0.32, 0.38, 0.32), hide, neck)

    head = empty(f"{prefix}Head", (0.0, 0.40, 0.23), neck)
    make_box_local(f"{prefix}Skull", (0.0, 0.10, 0.04), (0.48, 0.55, 0.4), hide, head)
    make_box_local(f"{prefix}Snout", (0.0, 0.50, -0.10), (0.34, 0.42, 0.24), hide, head)
    make_box_local(f"{prefix}Jaw", (0.0, 0.43, -0.28), (0.3, 0.38, 0.1), dark, head)
    make_box_local(f"{prefix}Teeth", (0.0, 0.46, -0.22), (0.26, 0.34, 0.05), claw, head)
    make_box_local(f"{prefix}Crest", (0.0, -0.04, 0.30), (0.08, 0.28, 0.18), crest, head)
    make_box_local(f"{prefix}EyeL", (0.2, 0.26, 0.12), (0.08, 0.08, 0.08), eye, head)
    make_box_local(f"{prefix}EyeR", (-0.2, 0.26, 0.12), (0.08, 0.08, 0.08), eye, head)

    tail_base = empty(f"{prefix}TailBase", (0.0, -0.55, 0.07), hips)
    make_box_local(f"{prefix}Tail1", (0.0, -0.17, 0.0), (0.38, 0.55, 0.34), hide, tail_base)
    tail_mid = empty(f"{prefix}TailMid", (0.0, -0.60, -0.04), tail_base)
    make_box_local(f"{prefix}Tail2", (0.0, -0.13, -0.02), (0.26, 0.5, 0.24), hide, tail_mid)
    tail_tip = empty(f"{prefix}TailTip", (0.0, -0.55, -0.08), tail_mid)
    make_box_local(f"{prefix}Tail3", (0.0, -0.12, -0.02), (0.14, 0.42, 0.14), dark, tail_tip)

    def limb(side: str, x: float) -> tuple[bpy.types.Object, bpy.types.Object]:
        thigh = empty(f"{prefix}Thigh{side}", (x, 0.05, -0.20), hips)
        make_box_local(f"{prefix}ThighMesh{side}", (0.0, 0.03, -0.23), (0.26, 0.32, 0.55), hide, thigh)
        shin = empty(f"{prefix}Shin{side}", (0.0, -0.03, -0.53), thigh)
        make_box_local(f"{prefix}ShinMesh{side}", (0.0, -0.04, -0.16), (0.2, 0.24, 0.38), dark, shin)
        make_box_local(f"{prefix}Foot{side}", (0.0, 0.12, -0.35), (0.22, 0.38, 0.1), claw, shin)
        return thigh, shin

    thigh_l, shin_l = limb("L", 0.28)
    thigh_r, shin_r = limb("R", -0.28)

    arm_l = empty(f"{prefix}ArmL", (0.34, 0.55, 0.17), hips)
    make_box_local(f"{prefix}ArmMeshL", (0.04, 0.13, -0.14), (0.1, 0.28, 0.1), hide, arm_l)
    arm_r = empty(f"{prefix}ArmR", (-0.34, 0.55, 0.17), hips)
    make_box_local(f"{prefix}ArmMeshR", (-0.04, 0.13, -0.14), (0.1, 0.28, 0.1), hide, arm_r)
    attach_gun(arm_r, prefix)

    frames = (1, 7, 13, 19, 24)
    stride = 0.55
    lift = 0.42

    for frame, phase in zip(frames, (0.0, 0.5, 1.0, 1.5, 2.0)):
        swing = math.sin(phase * math.pi) * stride
        opposite = -swing
        bend_l = lift if swing > 0 else 0.12
        bend_r = lift if opposite > 0 else 0.12
        bob = 1.15 + abs(math.sin(phase * math.pi)) * 0.08
        key_loc(hips, frame, (0.0, 0.0, bob))
        key_rot(hips, frame, (math.radians(-6 + math.sin(phase * math.pi) * 4), 0.0, 0.0))
        key_rot(thigh_l, frame, (swing, 0.0, 0.0))
        key_rot(thigh_r, frame, (opposite, 0.0, 0.0))
        key_rot(shin_l, frame, (bend_l, 0.0, 0.0))
        key_rot(shin_r, frame, (bend_r, 0.0, 0.0))
        key_rot(neck, frame, (math.radians(8 + math.sin(phase * math.pi) * 6), 0.0, 0.0))
        key_rot(head, frame, (math.radians(-4 + math.cos(phase * math.pi) * 5), 0.0, 0.0))
        key_rot(tail_base, frame, (0.0, 0.0, math.sin(phase * math.pi) * 0.28))
        key_rot(tail_mid, frame, (0.0, 0.0, math.sin(phase * math.pi) * 0.38))
        key_rot(tail_tip, frame, (0.0, 0.0, math.sin(phase * math.pi) * 0.22))
        key_rot(arm_l, frame, (opposite * 0.45, 0.0, 0.0))
        key_rot(arm_r, frame, (swing * 0.45, 0.0, 0.0))

    for obj in (hips, thigh_l, thigh_r, shin_l, shin_r, neck, head, tail_base, tail_mid, tail_tip, arm_l, arm_r):
        smooth_fcurves(obj)
        if obj.animation_data and obj.animation_data.action:
            obj.animation_data.action.name = "Walk"

    body.hide_render = False
    return root


def window_grid(
    name: str,
    origin: tuple[float, float, float],
    cols: int,
    rows: int,
    width: float,
    height: float,
    material: bpy.types.Material,
    parent: bpy.types.Object,
    axis: str = "y",
) -> None:
    ox, oy, oz = origin
    for row in range(rows):
        for col in range(cols):
            if axis == "y":
                loc = (ox + (col - (cols - 1) / 2) * width * 1.35, oy, oz + row * height * 1.45)
                size = (width, 0.06, height)
            else:
                loc = (ox, oy + (col - (cols - 1) / 2) * width * 1.35, oz + row * height * 1.45)
                size = (0.06, width, height)
            make_box(f"{name}_{row}_{col}", loc, size, material, parent)


def brownstone(
    name: str,
    x: float,
    y: float,
    facing: float,
    width: float,
    depth: float,
    floors: int,
    color: tuple[float, float, float],
    collisions: list[dict],
) -> bpy.types.Object:
    brick = mat(f"{name}_brick", color)
    stoop = mat("stoop", (0.45, 0.42, 0.38))
    night = mat("window_night", (0.85, 0.68, 0.28), roughness=0.25)
    dark_win = mat("window_dark", (0.12, 0.16, 0.2), roughness=0.18)
    cornice = mat("cornice", (0.72, 0.7, 0.64))
    height = 3.2 + floors * 3.1
    root = empty(name, (x, y, 0.0))
    root.rotation_euler = (0.0, 0.0, facing)
    body = make_box(f"{name}_body", (x, y, height / 2), (width, depth, height), brick, root)
    make_box(f"{name}_stoop", (x, y + depth * 0.42 * math.cos(facing), 0.35), (width * 0.42, 0.7, 0.7), stoop, root)
    make_box(f"{name}_cornice", (x, y, height + 0.12), (width + 0.25, depth + 0.18, 0.28), cornice, root)
    make_box(f"{name}_door", (x, y + (depth / 2 + 0.04) * math.cos(facing), 1.15), (0.7, 0.08, 1.7), dark_win, root)
    # windows sit on the street face
    face_y = y + (depth / 2 + 0.03) * math.cos(facing)
    face_x = x + (depth / 2 + 0.03) * math.sin(facing)
    if abs(math.cos(facing)) > 0.5:
        window_grid(f"{name}_win", (x, face_y, 3.4), 3, floors, 0.55, 0.85, night if floors % 2 else dark_win, root, "y")
    else:
        window_grid(f"{name}_win", (face_x, y, 3.4), 3, floors, 0.55, 0.85, night if floors % 2 else dark_win, root, "x")
    # fire escape
    if floors >= 3:
        make_box(f"{name}_escape", (x + width * 0.28, face_y, height * 0.55), (0.55, 0.12, height * 0.7), stoop, root)
    collisions.append(
        {
            "name": name,
            "min": [x - width / 2 - 0.15, y - depth / 2 - 0.15],
            "max": [x + width / 2 + 0.15, y + depth / 2 + 0.15],
        }
    )
    body["collision"] = True
    return root


def tower(
    name: str,
    x: float,
    y: float,
    w: float,
    d: float,
    h: float,
    color: tuple[float, float, float],
    collisions: list[dict],
) -> None:
    stone = mat(f"{name}_stone", color)
    glass = mat("tower_glass", (0.22, 0.32, 0.42), roughness=0.22)
    gold = mat("tower_gold", (0.72, 0.58, 0.28))
    root = empty(name, (x, y, 0.0))
    make_box(f"{name}_base", (x, y, h * 0.22), (w, d, h * 0.44), stone, root)
    make_box(f"{name}_mid", (x, y, h * 0.58), (w * 0.78, d * 0.78, h * 0.36), stone, root)
    make_box(f"{name}_cap", (x, y, h * 0.84), (w * 0.48, d * 0.48, h * 0.18), stone, root)
    make_box(f"{name}_spire", (x, y, h + 1.6), (0.35, 0.35, 3.4), gold, root)
    window_grid(f"{name}_winS", (x, y + d / 2 + 0.04, 4.0), 4, 6, 0.7, 1.0, glass, root, "y")
    window_grid(f"{name}_winN", (x, y - d / 2 - 0.04, 4.0), 4, 6, 0.7, 1.0, glass, root, "y")
    collisions.append({"name": name, "min": [x - w / 2, y - d / 2], "max": [x + w / 2, y + d / 2]})


def cab(x: float, y: float, yaw: float) -> None:
    yellow = mat("cab_yellow", (0.92, 0.75, 0.08))
    black = mat("cab_black", (0.08, 0.08, 0.08))
    chrome = mat("cab_chrome", (0.65, 0.66, 0.68), roughness=0.28)
    root = empty("YellowCab", (x, y, 0.0))
    root.rotation_euler = (0.0, 0.0, yaw)
    make_box("CabBody", (x, y, 0.55), (1.15, 2.35, 0.7), yellow, root)
    make_box("CabCabin", (x, y - 0.15, 1.05), (1.05, 1.35, 0.55), yellow, root)
    make_box("CabStripe", (x, y, 0.72), (1.18, 0.18, 0.12), black, root)
    make_box("CabLight", (x, y, 1.38), (0.35, 0.45, 0.12), chrome, root)
    for i, (wx, wy) in enumerate(((-0.55, 0.7), (0.55, 0.7), (-0.55, -0.75), (0.55, -0.75))):
        make_cylinder(f"CabWheel{i}", (x + wx, y + wy, 0.28), 0.28, 0.22, black, 8, root).rotation_euler = (
            0.0,
            math.pi / 2,
            0.0,
        )


def lamp(name: str, x: float, y: float) -> None:
    iron = mat("lamp_iron", (0.12, 0.12, 0.14))
    glow = mat("lamp_glow", (1.0, 0.86, 0.45), roughness=0.15)
    make_cylinder(f"{name}_pole", (x, y, 2.1), 0.07, 4.2, iron, 8)
    make_box(f"{name}_head", (x, y, 4.25), (0.45, 0.45, 0.28), glow)


def hydrant(name: str, x: float, y: float) -> None:
    red = mat("hydrant", (0.72, 0.12, 0.1))
    make_cylinder(name, (x, y, 0.42), 0.16, 0.84, red, 8)
    make_box(f"{name}_cap", (x, y, 0.9), (0.22, 0.22, 0.16), red)


def build_manhattan() -> dict:
    asphalt = mat("asphalt", (0.14, 0.15, 0.16), roughness=0.9)
    paint = mat("street_paint", (0.92, 0.9, 0.78))
    walk = mat("sidewalk", (0.55, 0.54, 0.5), roughness=0.85)
    curb = mat("curb", (0.42, 0.42, 0.4))
    granite = mat("plaza", (0.38, 0.4, 0.42))

    make_box("StreetNS", (0.0, 0.0, -0.08), (10.0, 72.0, 0.16), asphalt)
    make_box("StreetEW", (0.0, 0.0, -0.07), (72.0, 10.0, 0.16), asphalt)
    make_box("SidewalkN", (0.0, 18.5, 0.08), (72.0, 9.0, 0.16), walk)
    make_box("SidewalkS", (0.0, -18.5, 0.08), (72.0, 9.0, 0.16), walk)
    make_box("SidewalkE", (18.5, 0.0, 0.08), (9.0, 36.0, 0.16), walk)
    make_box("SidewalkW", (-18.5, 0.0, 0.08), (9.0, 36.0, 0.16), walk)
    make_box("CurbN", (0.0, 13.6, 0.12), (10.2, 0.35, 0.22), curb)
    make_box("CurbS", (0.0, -13.6, 0.12), (10.2, 0.35, 0.22), curb)

    for i, yy in enumerate((-4.2, -1.4, 1.4, 4.2)):
        make_box(f"CenterLine{i}", (0.0, yy, 0.01), (0.18, 1.6, 0.02), paint)
    for i, xx in enumerate((-4.2, -1.4, 1.4, 4.2)):
        make_box(f"CenterLineE{i}", (xx, 0.0, 0.01), (1.6, 0.18, 0.02), paint)

    # crosswalks
    for i in range(6):
        make_box(f"XwalkN{i}", (-3.5 + i * 1.4, 6.2, 0.02), (0.7, 2.2, 0.02), paint)
        make_box(f"XwalkS{i}", (-3.5 + i * 1.4, -6.2, 0.02), (0.7, 2.2, 0.02), paint)
        make_box(f"XwalkE{i}", (6.2, -3.5 + i * 1.4, 0.02), (2.2, 0.7, 0.02), paint)
        make_box(f"XwalkW{i}", (-6.2, -3.5 + i * 1.4, 0.02), (2.2, 0.7, 0.02), paint)

    collisions: list[dict] = []
    brown_colors = [
        (0.42, 0.22, 0.16),
        (0.5, 0.28, 0.18),
        (0.36, 0.2, 0.15),
        (0.46, 0.3, 0.2),
    ]
    xs = (-28.0, -20.5, -13.0, 13.0, 20.5, 28.0)
    for i, bx in enumerate(xs):
        brownstone(f"BrownstoneN{i}", bx, 26.5, 0.0, 6.6, 8.4, 3 + (i % 3), brown_colors[i % 4], collisions)
        brownstone(f"BrownstoneS{i}", bx, -26.5, math.pi, 6.6, 8.4, 3 + ((i + 1) % 3), brown_colors[(i + 2) % 4], collisions)

    tower("DecoTower", 26.5, 0.0, 10.5, 10.5, 28.0, (0.62, 0.6, 0.52), collisions)
    tower("MidriseW", -26.5, 0.0, 11.0, 10.0, 18.0, (0.4, 0.44, 0.48), collisions)

    # extra mid block buildings on the corners
    make_box("CornerNE", (26.5, 26.5, 7.5), (10.0, 8.5, 15.0), mat("limestone", (0.7, 0.66, 0.55)))
    collisions.append({"name": "CornerNE", "min": [21.5, 22.25], "max": [31.5, 30.75]})
    make_box("CornerSW", (-26.5, -26.5, 6.2), (10.0, 8.5, 12.4), mat("warehouse", (0.32, 0.3, 0.28)))
    collisions.append({"name": "CornerSW", "min": [-31.5, -30.75], "max": [-21.5, -22.25]})

    # water towers
    tin = mat("water_tower", (0.55, 0.42, 0.32))
    make_cylinder("WaterTowerN", (-20.5, 26.5, 14.2), 1.1, 2.4, tin, 10)
    make_cylinder("WaterTowerS", (13.0, -26.5, 15.4), 1.1, 2.4, tin, 10)

    # subway kiosk
    green = mat("subway", (0.12, 0.28, 0.18))
    make_box("SubwayKiosk", (-8.8, 12.4, 1.35), (2.4, 1.6, 2.7), green)
    make_box("SubwaySign", (-8.8, 12.4, 2.85), (2.1, 0.12, 0.45), mat("subway_sign", (0.08, 0.35, 0.22)))
    collisions.append({"name": "SubwayKiosk", "min": [-10.1, 11.5], "max": [-7.5, 13.3]})

    cab(4.8, -11.5, math.radians(12))
    lamp("LampNE", 6.8, 12.8)
    lamp("LampNW", -6.8, 12.8)
    lamp("LampSE", 6.8, -12.8)
    lamp("LampSW", -6.8, -12.8)
    hydrant("Hydrant1", 7.4, 10.6)
    hydrant("Hydrant2", -7.6, -10.4)

    make_box("Newsstand", (8.6, -12.6, 0.85), (1.6, 1.1, 1.5), mat("news", (0.55, 0.12, 0.12)))
    collisions.append({"name": "Newsstand", "min": [7.7, -13.3], "max": [9.5, -12.0]})

    make_box("Planter", (-9.2, -12.8, 0.35), (1.3, 1.3, 0.7), granite)

    # glTF Y-up export maps Blender ground (X, Y) -> Three.js (X, -Y).
    three_buildings = []
    for box in collisions:
        x0, y0 = box["min"]
        x1, y1 = box["max"]
        three_buildings.append(
            {
                "name": box["name"],
                "min": [min(x0, x1), min(-y0, -y1)],
                "max": [max(x0, x1), max(-y0, -y1)],
            }
        )
    return {
        "buildings": three_buildings,
        "bounds": {"min": [-34.0, -34.0], "max": [34.0, 34.0]},
        "spawn": [0.0, 0.0],
        "groundY": 0.0,
        "space": "three-xz-after-gltf-yup",
    }


def isolate(keep_names: set[str]) -> None:
    for obj in list(bpy.data.objects):
        obj.select_set(obj.name in keep_names or any(obj.name.startswith(p) for p in keep_names))


def collect_hierarchy(root: bpy.types.Object) -> list[bpy.types.Object]:
    out = [root]
    for child in root.children:
        out.extend(collect_hierarchy(child))
    return out


def export_glb(path: Path, objects: list[bpy.types.Object], animations: bool) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
    path.parent.mkdir(parents=True, exist_ok=True)
    kwargs = dict(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_yup=True,
    )
    # Blender 4/5 GLTF exporter flag names drifted; try the current then older ones.
    try:
        bpy.ops.export_scene.gltf(
            **kwargs,
            export_animations=animations,
            export_animation_mode="ACTIONS" if animations else "NLA_TRACKS",
        )
    except TypeError:
        bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True)


def hide_unrelated(keep: set[bpy.types.Object]) -> dict[str, bool]:
    previous = {}
    for obj in bpy.data.objects:
        previous[obj.name] = obj.hide_render
        obj.hide_viewport = obj not in keep
        obj.hide_render = obj not in keep
        obj.select_set(obj in keep)
    return previous


def main() -> None:
    root = repo_root()
    models = root / "public" / "models"
    blend_dir = root / "blender"
    models.mkdir(parents=True, exist_ok=True)
    blend_dir.mkdir(parents=True, exist_ok=True)

    reset_scene()
    dino = build_dino("Dino")
    enemy = build_dino(
        "Enemy",
        hide_color=(0.52, 0.16, 0.14),
        belly_color=(0.42, 0.28, 0.16),
        crest_color=(0.12, 0.1, 0.1),
    )
    dino.location = (80.0, 80.0, 0.0)
    enemy.location = (90.0, 80.0, 0.0)
    collision = build_manhattan()

    (models / "collision.json").write_text(json.dumps(collision, indent=2))

    skip = {dino.name, enemy.name}
    city_objects = [
        obj
        for obj in bpy.data.objects
        if obj.name not in skip and not obj.name.startswith("Dino") and not obj.name.startswith("Enemy")
    ]
    export_glb(models / "manhattan.glb", city_objects, animations=False)

    dino.location = (0.0, 0.0, 0.0)
    export_glb(models / "dino.glb", collect_hierarchy(dino), animations=True)

    enemy.location = (0.0, 0.0, 0.0)
    export_glb(models / "enemy.glb", collect_hierarchy(enemy), animations=True)

    dino.location = (0.0, 8.0, 0.0)
    enemy.location = (0.0, -8.0, 0.0)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_dir / "dino_manhattan.blend"))
    print("Wrote", models / "dino.glb")
    print("Wrote", models / "enemy.glb")
    print("Wrote", models / "manhattan.glb")
    print("Wrote", models / "collision.json")
    print("Wrote", blend_dir / "dino_manhattan.blend")


if __name__ == "__main__":
    main()
