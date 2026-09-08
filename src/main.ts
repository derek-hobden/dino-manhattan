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
const PLAYER_MAX = 100;
const ENEMY_MAX = 80;
const LOOK_SENS = 0.0024;

const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));

function aabbsFromCity(root: THREE.Object3D): Aabb[] {
  const boxes: Aabb[] = [];
  const seen = new Set<string>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !SOLID.test(child.name)) return;
    const box = new THREE.Box3().setFromObject(child);
    const key = `${child.name}:${box.min.x.toFixed(2)}:${box.min.z.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    boxes.push({ name: child.name, min: [box.min.x, box.min.z], max: [box.max.x, box.max.z] });
  });
  return boxes;
}

function circleHitsAabb(x: number, z: number, radius: number, box: Aabb): boolean {
  const nearestX = Math.max(box.min[0], Math.min(x, box.max[0]));
  const nearestZ = Math.max(box.min[1], Math.min(z, box.max[1]));
  const dx = x - nearestX;
  const dz = z - nearestZ;
  return dx * dx + dz * dz < radius * radius;
}

function segmentHitsAabb(ax: number, az: number, bx: number, bz: number, box: Aabb): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const min = [box.min[0], box.min[1]];
  const max = [box.max[0], box.max[1]];
  const origin = [ax, az];
  const dir = [dx, dz];
  for (let i = 0; i < 2; i++) {
    if (Math.abs(dir[i]) < 1e-8) {
      if (origin[i] < min[i] || origin[i] > max[i]) return false;
      continue;
    }
    let tmin = (min[i] - origin[i]) / dir[i];
    let tmax = (max[i] - origin[i]) / dir[i];
    if (tmin > tmax) [tmin, tmax] = [tmax, tmin];
    t0 = Math.max(t0, tmin);
    t1 = Math.min(t1, tmax);
    if (t0 > t1) return false;
  }
  return true;
}

function lerpAngle(from: number, to: number, t: number): number {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * t;
}

function findNamed(root: THREE.Object3D, suffix: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((child) => {
    if (!found && child.name.endsWith(suffix)) found = child;
  });
  return found;
}

function playClips(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
  const mixer = new THREE.AnimationMixer(root);
  const actions = clips.map((clip) => {
    const action = mixer.clipAction(clip);
    action.play();
    action.paused = true;
    return action;
  });
  return { mixer, actions };
}

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7ea4c8);
scene.fog = new THREE.Fog(0x8eb0cc, 28, 95);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 6, -12);

scene.add(new THREE.HemisphereLight(0xb7d3ef, 0x3b2a1c, 1.05));
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

function enableShadows(root: THREE.Object3D) {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

type Bolt = {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  from: "player" | "enemy";
};

async function boot() {
  const loader = new GLTFLoader();
  const [dinoGltf, enemyGltf, cityGltf, collision] = await Promise.all([
    loader.loadAsync("/models/dino.glb"),
    loader.loadAsync("/models/enemy.glb"),
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

  const player = dinoGltf.scene;
  player.position.set(collision.spawn[0], collision.groundY, collision.spawn[1]);
  enableShadows(player);
  scene.add(player);
  const playerAnim = playClips(player, dinoGltf.animations);
  const playerMuzzle = findNamed(player, "Muzzle");

  const enemy = enemyGltf.scene;
  enemy.position.set(0, collision.groundY, 16);
  enableShadows(enemy);
  scene.add(enemy);
  const enemyAnim = playClips(enemy, enemyGltf.animations);
  const enemyMuzzle = findNamed(enemy, "Muzzle");

  const radius = 0.7;
  const up = new THREE.Vector3(0, 1, 0);
  const look = new THREE.Vector3();
  const camDesired = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const camForward = new THREE.Vector3();
  const move = new THREE.Vector3();
  const muzzleWorld = new THREE.Vector3();
  const aimDir = new THREE.Vector3();
  const clock = new THREE.Clock();

  let camYaw = 0;
  let camPitch = 0.32;
  let facing = 0;
  let locked = false;
  let shooting = false;
  let playerHp = PLAYER_MAX;
  let enemyHp = ENEMY_MAX;
  let ended: "win" | "lose" | null = null;
  let enemyCooldown = 0.6;
  const bolts: Bolt[] = [];

  const hpPlayer = document.querySelector("#hp-player") as HTMLElement;
  const hpEnemy = document.querySelector("#hp-enemy") as HTMLElement;
  const hint = document.querySelector("#hint") as HTMLElement;
  const banner = document.querySelector("#banner") as HTMLElement;

  function blocked(x: number, z: number, ignore?: THREE.Object3D): boolean {
    if (x < bounds.min[0] + radius || x > bounds.max[0] - radius || z < bounds.min[1] + radius || z > bounds.max[1] - radius) {
      return true;
    }
    if (buildings.some((box) => circleHitsAabb(x, z, radius, box))) return true;
    if (ignore !== enemy && circleHitsAabb(x, z, radius + 0.35, actorBox(enemy))) return true;
    if (ignore !== player && circleHitsAabb(x, z, radius + 0.35, actorBox(player))) return true;
    return false;
  }

  function actorBox(obj: THREE.Object3D): Aabb {
    return {
      name: obj.name,
      min: [obj.position.x - 0.7, obj.position.z - 0.7],
      max: [obj.position.x + 0.7, obj.position.z + 0.7],
    };
  }

  function hasLos(from: THREE.Vector3, to: THREE.Vector3): boolean {
    return !buildings.some((box) => segmentHitsAabb(from.x, from.z, to.x, to.z, box));
  }

  function setAnim(pack: ReturnType<typeof playClips>, on: boolean, sprint = false) {
    for (const action of pack.actions) {
      action.paused = !on;
      action.timeScale = sprint ? 1.45 : 1;
    }
  }

  function refreshBars() {
    hpPlayer.style.width = `${Math.max(0, (playerHp / PLAYER_MAX) * 100)}%`;
    hpEnemy.style.width = `${Math.max(0, (enemyHp / ENEMY_MAX) * 100)}%`;
  }

  function showEnd(kind: "win" | "lose") {
    ended = kind;
    banner.hidden = false;
    banner.innerHTML =
      kind === "win"
        ? `BLOCK CLEARED<button type="button" id="restart">PLAY AGAIN</button>`
        : `YOU GOT ATE<button type="button" id="restart">RESTART</button>`;
    banner.querySelector("button")?.addEventListener("click", () => {
      document.exitPointerLock();
      window.location.reload();
    });
    hint.textContent = kind === "win" ? "The rust dino is down." : "Click restart.";
  }

  function spawnBolt(from: THREE.Object3D | null, fallback: THREE.Object3D, dir: THREE.Vector3, team: "player" | "enemy") {
    const origin = from ? from.getWorldPosition(muzzleWorld) : fallback.position.clone().setY(1.4);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 8),
      new THREE.MeshBasicMaterial({ color: team === "player" ? 0xffe566 : 0xff5533 }),
    );
    mesh.position.copy(origin);
    scene.add(mesh);
    const flash = new THREE.PointLight(team === "player" ? 0xffe566 : 0xff5533, 4, 6);
    flash.position.copy(origin);
    scene.add(flash);
    window.setTimeout(() => scene.remove(flash), 60);
    const vel = dir.clone().normalize().multiplyScalar(team === "player" ? 38 : 28);
    bolts.push({ mesh, vel, life: 1.15, from: team });
  }

  renderer.domElement.addEventListener("click", () => {
    if (ended) return;
    if (!locked) {
      renderer.domElement.requestPointerLock();
      return;
    }
    shooting = true;
    const lookYaw = camYaw;
    aimDir.set(Math.sin(lookYaw), 0.02, Math.cos(lookYaw));
    spawnBolt(playerMuzzle, player, aimDir, "player");
  });

  document.addEventListener("pointerlockchange", () => {
    locked = document.pointerLockElement === renderer.domElement;
    hint.textContent = locked
      ? "W/S walk · A/D strafe (no turn) · mouse look · LMB shoot"
      : "Click the street to capture the mouse. Esc releases.";
  });

  document.addEventListener("mousemove", (e) => {
    if (!locked || ended) return;
    camYaw -= e.movementX * LOOK_SENS;
    camPitch = THREE.MathUtils.clamp(camPitch + e.movementY * LOOK_SENS, -0.15, 1.05);
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  refreshBars();

  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");

    camForward.set(Math.sin(camYaw), 0, Math.cos(camYaw));
    camRight.crossVectors(up, camForward).normalize();

    const fwd = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const str = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    move.copy(camForward).multiplyScalar(fwd).addScaledVector(camRight, str);

    const walking = move.lengthSq() > 0 && !ended;
    if (walking) {
      move.normalize();
      const speed = sprint ? 10.5 : 6.2;
      const nextX = player.position.x + move.x * speed * dt;
      const nextZ = player.position.z + move.z * speed * dt;
      if (!blocked(nextX, player.position.z, player)) player.position.x = nextX;
      if (!blocked(player.position.x, nextZ, player)) player.position.z = nextZ;
      // A/D alone never yaws. Only a W/S component updates facing.
      if (fwd !== 0) facing = Math.atan2(move.x, move.z);
    } else if (shooting && !ended) {
      facing = camYaw;
    }

    playerAnim.mixer.update(dt);
    enemyAnim.mixer.update(dt);
    setAnim(playerAnim, walking, sprint);
    player.rotation.y = lerpAngle(player.rotation.y, facing, 1 - Math.exp(-14 * dt));

    if (!ended && enemyHp > 0) {
      const toPlayer = new THREE.Vector3().subVectors(player.position, enemy.position);
      toPlayer.y = 0;
      const dist = toPlayer.length();
      const canSee = dist < 42 && hasLos(enemy.position, player.position);
      if (dist > 0.001) {
        const chase = toPlayer.normalize();
        enemy.rotation.y = lerpAngle(enemy.rotation.y, Math.atan2(chase.x, chase.z), 1 - Math.exp(-8 * dt));
        if (dist > 9) {
          const nx = enemy.position.x + chase.x * 3.4 * dt;
          const nz = enemy.position.z + chase.z * 3.4 * dt;
          if (!blocked(nx, enemy.position.z, enemy)) enemy.position.x = nx;
          if (!blocked(enemy.position.x, nz, enemy)) enemy.position.z = nz;
          setAnim(enemyAnim, true);
        } else {
          setAnim(enemyAnim, false);
        }
      }
      enemyCooldown -= dt;
      if (canSee && enemyCooldown <= 0) {
        enemyCooldown = 0.85;
        aimDir.set(Math.sin(enemy.rotation.y), 0.02, Math.cos(enemy.rotation.y));
        spawnBolt(enemyMuzzle, enemy, aimDir, "enemy");
      }
    } else {
      setAnim(enemyAnim, false);
    }

    for (let i = bolts.length - 1; i >= 0; i--) {
      const bolt = bolts[i];
      bolt.mesh.position.addScaledVector(bolt.vel, dt);
      bolt.life -= dt;
      const p = bolt.mesh.position;
      const hitBuilding = buildings.some((box) => circleHitsAabb(p.x, p.z, 0.12, box));
      let consumed = bolt.life <= 0 || hitBuilding;
      if (!consumed && bolt.from === "player" && enemyHp > 0 && p.distanceTo(enemy.position) < 1.15) {
        enemyHp -= 20;
        consumed = true;
        if (enemyHp <= 0) {
          enemy.visible = false;
          refreshBars();
          showEnd("win");
        }
      }
      if (!consumed && bolt.from === "enemy" && playerHp > 0 && p.distanceTo(player.position) < 1.15) {
        playerHp -= 14;
        consumed = true;
        if (playerHp <= 0) {
          refreshBars();
          showEnd("lose");
        }
      }
      if (consumed) {
        scene.remove(bolt.mesh);
        bolts.splice(i, 1);
      }
    }
    refreshBars();
    shooting = false;

    const dist = 8.6;
    const planar = Math.cos(camPitch) * dist;
    camDesired.set(
      player.position.x - Math.sin(camYaw) * planar,
      player.position.y + 2.1 + Math.sin(camPitch) * dist,
      player.position.z - Math.cos(camYaw) * planar,
    );
    camera.position.lerp(camDesired, 1 - Math.exp(-10 * dt));
    look.set(player.position.x, player.position.y + 1.35, player.position.z);
    camera.lookAt(look);

    document.documentElement.dataset.facing = facing.toFixed(4);
    document.documentElement.dataset.px = player.position.x.toFixed(3);
    document.documentElement.dataset.pz = player.position.z.toFixed(3);
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
