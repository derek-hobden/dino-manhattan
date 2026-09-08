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

function rayHitsAabb3(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  min: [number, number, number],
  max: [number, number, number],
  maxDist: number,
): number | null {
  let t0 = 0;
  let t1 = maxDist;
  const origin = [ox, oy, oz];
  const dir = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-8) {
      if (origin[i] < min[i] || origin[i] > max[i]) return null;
      continue;
    }
    let tmin = (min[i] - origin[i]) / dir[i];
    let tmax = (max[i] - origin[i]) / dir[i];
    if (tmin > tmax) [tmin, tmax] = [tmax, tmin];
    t0 = Math.max(t0, tmin);
    t1 = Math.min(t1, tmax);
    if (t0 > t1) return null;
  }
  return t0 >= 0 ? t0 : t1 >= 0 ? t1 : null;
}

function bodyVolume(obj: THREE.Object3D): { min: [number, number, number]; max: [number, number, number] } {
  const x = obj.position.x;
  const z = obj.position.z;
  return {
    min: [x - 1.25, 0, z - 1.25],
    max: [x + 1.25, 2.5, z + 1.25],
  };
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

type Tracer = { mesh: THREE.Line; life: number };

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
  let locked = false;
  let playerHp = PLAYER_MAX;
  let enemyHp = ENEMY_MAX;
  let ended: "win" | "lose" | null = null;
  let enemyCooldown = 0.6;
  const tracers: Tracer[] = [];
  const hitFlashes: { mesh: THREE.Mesh; life: number }[] = [];

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

  function flashHit(at: THREE.Vector3, color: number) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 10, 10),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
    );
    mesh.position.copy(at);
    scene.add(mesh);
    hitFlashes.push({ mesh, life: 0.28 });
    const light = new THREE.PointLight(color, 6, 8);
    light.position.copy(at);
    scene.add(light);
    window.setTimeout(() => scene.remove(light), 80);
  }

  function drawTracer(from: THREE.Vector3, to: THREE.Vector3, color: number) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mesh = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, linewidth: 2 }));
    scene.add(mesh);
    tracers.push({ mesh, life: 0.12 });
  }

  function hitscan(origin: THREE.Vector3, dir: THREE.Vector3, team: "player" | "enemy") {
    const range = 70;
    const nd = dir.clone().normalize();
    let best = range;
    let hitActor: "player" | "enemy" | null = null;
    let hitPoint = origin.clone().addScaledVector(nd, range);

    if (team === "player" && enemyHp > 0 && enemy.visible) {
      const vol = bodyVolume(enemy);
      const t = rayHitsAabb3(origin.x, origin.y, origin.z, nd.x, nd.y, nd.z, vol.min, vol.max, range);
      if (t !== null && t < best) {
        best = t;
        hitActor = "enemy";
        hitPoint.copy(origin).addScaledVector(nd, t);
      }
    }
    if (team === "enemy" && playerHp > 0) {
      const vol = bodyVolume(player);
      const t = rayHitsAabb3(origin.x, origin.y, origin.z, nd.x, nd.y, nd.z, vol.min, vol.max, range);
      if (t !== null && t < best) {
        best = t;
        hitActor = "player";
        hitPoint.copy(origin).addScaledVector(nd, t);
      }
    }
    for (const box of buildings) {
      const t = rayHitsAabb3(
        origin.x,
        origin.y,
        origin.z,
        nd.x,
        nd.y,
        nd.z,
        [box.min[0], 0, box.min[1]],
        [box.max[0], 28, box.max[1]],
        range,
      );
      if (t !== null && t < best) {
        best = t;
        hitActor = null;
        hitPoint.copy(origin).addScaledVector(nd, t);
      }
    }

    drawTracer(origin, hitPoint, team === "player" ? 0xffe566 : 0xff5533);
    flashHit(origin, team === "player" ? 0xffe566 : 0xff7744);

    if (hitActor === "enemy") {
      enemyHp -= 20;
      flashHit(hitPoint, 0xffffff);
      hint.textContent = `HIT + enemy HP ${Math.max(0, enemyHp)}/${ENEMY_MAX}`;
      if (enemyHp <= 0) {
        enemy.visible = false;
        refreshBars();
        showEnd("win");
      }
    } else if (hitActor === "player") {
      playerHp -= 14;
      flashHit(hitPoint, 0xff8866);
      hint.textContent = `YOU WERE HIT · HP ${Math.max(0, playerHp)}/${PLAYER_MAX}`;
      if (playerHp <= 0) {
        refreshBars();
        showEnd("lose");
      }
    }
    refreshBars();
  }

  function firePlayer() {
    if (ended) return;
    aimDir.set(Math.sin(camYaw), 0.05, Math.cos(camYaw));
    const origin = player.position.clone();
    origin.y = 1.35;
    origin.addScaledVector(aimDir, 0.55);
    if (playerMuzzle) flashHit(playerMuzzle.getWorldPosition(muzzleWorld), 0xffe566);
    hitscan(origin, aimDir, "player");
  }

  function fireEnemy() {
    if (ended || enemyHp <= 0) return;
    const origin = enemy.position.clone();
    origin.y = 1.35;
    aimDir.set(player.position.x - enemy.position.x, 0.05, player.position.z - enemy.position.z);
    if (aimDir.lengthSq() < 1e-6) return;
    origin.addScaledVector(aimDir.clone().normalize(), 0.55);
    if (enemyMuzzle) flashHit(enemyMuzzle.getWorldPosition(muzzleWorld), 0xff5533);
    hitscan(origin, aimDir, "enemy");
  }

  renderer.domElement.addEventListener("click", () => {
    if (ended) return;
    if (!locked) {
      renderer.domElement.requestPointerLock();
      return;
    }
    firePlayer();
  });
  (window as unknown as { __fire: () => void; __look: (yaw: number) => void }).__fire = firePlayer;
  (window as unknown as { __fire: () => void; __look: (yaw: number) => void }).__look = (yaw: number) => {
    camYaw = yaw;
  };

  document.addEventListener("pointerlockchange", () => {
    locked = document.pointerLockElement === renderer.domElement;
    hint.textContent = locked
      ? "Mouse turns you · W/S along look · A/D strafe · LMB hitscan"
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
    }

    playerAnim.mixer.update(dt);
    enemyAnim.mixer.update(dt);
    setAnim(playerAnim, walking, sprint);
    // Yaw is camera-tied only. A/D never rotate the dino.
    player.rotation.y = lerpAngle(player.rotation.y, camYaw, 1 - Math.exp(-16 * dt));

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
        fireEnemy();
      }
    } else {
      setAnim(enemyAnim, false);
    }

    for (let i = tracers.length - 1; i >= 0; i--) {
      tracers[i].life -= dt;
      if (tracers[i].life <= 0) {
        scene.remove(tracers[i].mesh);
        tracers[i].mesh.geometry.dispose();
        tracers.splice(i, 1);
      }
    }
    for (let i = hitFlashes.length - 1; i >= 0; i--) {
      hitFlashes[i].life -= dt;
      const mat = hitFlashes[i].mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, hitFlashes[i].life / 0.28);
      hitFlashes[i].mesh.scale.setScalar(1 + (0.28 - hitFlashes[i].life) * 4);
      if (hitFlashes[i].life <= 0) {
        scene.remove(hitFlashes[i].mesh);
        hitFlashes[i].mesh.geometry.dispose();
        hitFlashes.splice(i, 1);
      }
    }
    refreshBars();

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

    document.documentElement.dataset.facing = camYaw.toFixed(4);
    document.documentElement.dataset.yaw = player.rotation.y.toFixed(4);
    document.documentElement.dataset.px = player.position.x.toFixed(3);
    document.documentElement.dataset.pz = player.position.z.toFixed(3);
    document.documentElement.dataset.enemyHp = String(enemyHp);
    document.documentElement.dataset.playerHp = String(playerHp);
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
