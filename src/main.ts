import "./style.css";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type Aabb = { name: string; min: [number, number]; max: [number, number] };
type CollisionMap = {
  buildings: Aabb[];
  bounds: { min: [number, number]; max: [number, number] };
  spawn: [number, number];
  groundY: number;
};

const SOLID = /^(Brownstone\w+_body|Deco\w+_base|Midrise\w+_base|Corner|SubwayKiosk|Newsstand|CabBody|Hydrant|Planter)/i;

function aabbsFromCity(root: THREE.Object3D): Aabb[] {
  const boxes: Aabb[] = [];
  const seen = new Set<string>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !SOLID.test(child.name)) return;
    const box = new THREE.Box3().setFromObject(child);
    const key = `${child.name}:${box.min.x.toFixed(2)}:${box.min.z.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    boxes.push({
      name: child.name,
      min: [box.min.x, box.min.z],
      max: [box.max.x, box.max.z],
    });
  });
  return boxes;
}

const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));

const canvasHost = document.body;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
canvasHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7ea4c8);
scene.fog = new THREE.Fog(0x8eb0cc, 28, 95);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 6, -12);

const hemi = new THREE.HemisphereLight(0xb7d3ef, 0x3b2a1c, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe2b0, 1.35);
sun.position.set(-18, 32, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
scene.add(sun);
scene.add(new THREE.AmbientLight(0x6f7f99, 0.28));

function enableShadows(root: THREE.Object3D, cast: boolean, receive: boolean) {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = cast;
      child.receiveShadow = receive;
    }
  });
}

function circleHitsAabb(x: number, z: number, radius: number, box: Aabb): boolean {
  const nearestX = Math.max(box.min[0], Math.min(x, box.max[0]));
  const nearestZ = Math.max(box.min[1], Math.min(z, box.max[1]));
  const dx = x - nearestX;
  const dz = z - nearestZ;
  return dx * dx + dz * dz < radius * radius;
}

function lerpAngle(from: number, to: number, t: number): number {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * t;
}

async function boot() {
  const loader = new GLTFLoader();
  const [dinoGltf, cityGltf, collision] = await Promise.all([
    loader.loadAsync("/models/dino.glb"),
    loader.loadAsync("/models/manhattan.glb"),
    fetch("/models/collision.json").then((r) => r.json()) as Promise<CollisionMap>,
  ]);

  const city = cityGltf.scene;
  city.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.receiveShadow = true;
      const n = child.name.toLowerCase();
      child.castShadow = !n.includes("street") && !n.includes("sidewalk") && !n.includes("xwalk") && !n.includes("centerline");
    }
  });
  scene.add(city);

  const fromMeshes = aabbsFromCity(city);
  const buildings = fromMeshes.length > 0 ? fromMeshes : collision.buildings;
  const world = new THREE.Box3().setFromObject(city);
  const bounds = {
    min: [world.min.x + 1.2, world.min.z + 1.2] as [number, number],
    max: [world.max.x - 1.2, world.max.z - 1.2] as [number, number],
  };

  const dino = dinoGltf.scene;
  dino.position.set(collision.spawn[0], collision.groundY, collision.spawn[1]);
  enableShadows(dino, true, true);
  scene.add(dino);

  const mixer = new THREE.AnimationMixer(dino);
  const walks = dinoGltf.animations.map((clip) => {
    const action = mixer.clipAction(clip);
    action.play();
    action.paused = true;
    return action;
  });

  const radius = 0.7;
  const up = new THREE.Vector3(0, 1, 0);
  const look = new THREE.Vector3();
  const camDesired = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const camForward = new THREE.Vector3();
  const move = new THREE.Vector3();
  const clock = new THREE.Clock();
  let facing = 0;
  let camYaw = 0;

  function blocked(x: number, z: number): boolean {
    if (x < bounds.min[0] + radius || x > bounds.max[0] - radius || z < bounds.min[1] + radius || z > bounds.max[1] - radius) {
      return true;
    }
    return buildings.some((box) => circleHitsAabb(x, z, radius, box));
  }

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const speed = sprint ? 10.5 : 6.2;

    // Planar heading from camera -> dino (stable WASD, not a flipped right-vector).
    camForward.set(dino.position.x - camera.position.x, 0, dino.position.z - camera.position.z);
    if (camForward.lengthSq() < 1e-6) camForward.set(0, 0, 1);
    camForward.normalize();
    camRight.crossVectors(up, camForward).normalize();

    move.set(0, 0, 0);
    if (keys.has("KeyW") || keys.has("ArrowUp")) move.add(camForward);
    if (keys.has("KeyS") || keys.has("ArrowDown")) move.sub(camForward);
    if (keys.has("KeyD") || keys.has("ArrowRight")) move.add(camRight);
    if (keys.has("KeyA") || keys.has("ArrowLeft")) move.sub(camRight);

    const walking = move.lengthSq() > 0;
    if (walking) {
      move.normalize();
      const nextX = dino.position.x + move.x * speed * dt;
      const nextZ = dino.position.z + move.z * speed * dt;
      if (!blocked(nextX, dino.position.z)) dino.position.x = nextX;
      if (!blocked(dino.position.x, nextZ)) dino.position.z = nextZ;
      facing = Math.atan2(move.x, move.z);
    }

    for (const walk of walks) {
      walk.paused = !walking;
      walk.timeScale = sprint ? 1.45 : 1;
    }
    mixer.update(dt);
    dino.rotation.y = lerpAngle(dino.rotation.y, facing, 1 - Math.exp(-12 * dt));

    const back = 8.4;
    const height = 4.4;
    camYaw = lerpAngle(camYaw, facing, 1 - Math.exp(-3.4 * dt));
    camDesired.set(
      dino.position.x - Math.sin(camYaw) * back,
      dino.position.y + height,
      dino.position.z - Math.cos(camYaw) * back,
    );
    camera.position.lerp(camDesired, 1 - Math.exp(-6 * dt));
    look.set(dino.position.x, dino.position.y + 1.35, dino.position.z);
    camera.lookAt(look);

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

boot().catch((err) => {
  const hud = document.querySelector("#hint");
  if (hud) hud.textContent = `Failed to load demo: ${String(err)}`;
  console.error(err);
});
