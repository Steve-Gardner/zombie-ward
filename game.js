import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// ---------------------------------------------------------------------------
// Core setup
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
const scene = new THREE.Scene();
const ARENA_RADIUS = 34;
const WORLD_RADIUS = 112; // how far you can roam once you've turned
// Difficulty (chosen on the main menu, remembered between sessions)
const DIFFICULTIES = {
  easy: { hp: 0.7, speed: 0.85, dmg: 0.65, count: 0.75 },
  intermediate: { hp: 1, speed: 1, dmg: 1, count: 1 },
  hard: { hp: 1.4, speed: 1.2, dmg: 1.4, count: 1.4 },
};
let difficultyKey = 'intermediate';
try { const saved = localStorage.getItem('zw_difficulty'); if (DIFFICULTIES[saved]) difficultyKey = saved; } catch (e) { /* storage unavailable */ }
let difficulty = DIFFICULTIES[difficultyKey];
const waveCount = n => Math.max(2, Math.round((3 + Math.floor(n * 1.8)) * difficulty.count));

const HOUSE_Z = ARENA_RADIUS - 9;
const PLAYER_SPAWN_Z = HOUSE_Z + 1.2; // inside the house, facing the door
const HOUSE_BEARING = Math.PI / 2; // the house sits toward +Z from the yard's center
const HOUSE_BEARING_HALF = 0.85;
function angleDistance(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}
function randomYardAngle() {
  let ang;
  do { ang = Math.random() * Math.PI * 2; } while (angleDistance(ang, HOUSE_BEARING) < HOUSE_BEARING_HALF);
  return ang;
}

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 500);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// Fog for depth / atmosphere — hazy, sickly dusk air
scene.fog = new THREE.FogExp2(0x070b14, 0.011);

// ---------------------------------------------------------------------------
// Sky + Sun
// ---------------------------------------------------------------------------
const sky = new Sky();
sky.scale.setScalar(450000);
scene.add(sky);
// Night: the sky shader's "sun" sits below the horizon (deep blue-black sky);
// the moon is a separate light/disc up in the sky.
const sun = new THREE.Vector3(); // direction of the moonlight
{
  const u = sky.material.uniforms;
  u['turbidity'].value = 0.4;
  u['rayleigh'].value = 0.12;
  u['mieCoefficient'].value = 0.0008;
  u['mieDirectionalG'].value = 0.7;
  const below = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(100), THREE.MathUtils.degToRad(110));
  u['sunPosition'].value.copy(below);
  sun.setFromSphericalCoords(1, THREE.MathUtils.degToRad(48), THREE.MathUtils.degToRad(150));
}

// Stars + moon ride along with the camera so they never get closer.
const skyDome = new THREE.Group();
{
  const n = 900, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().setFromSphericalCoords(430, Math.acos(Math.random() * 0.95), Math.random() * Math.PI * 2);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  skyDome.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 })));
  const moon = new THREE.Mesh(new THREE.SphereGeometry(16, 24, 16), new THREE.MeshBasicMaterial({ color: 0xe9eeff, fog: false }));
  moon.position.copy(sun).multiplyScalar(420);
  skyDome.add(moon);
}
scene.add(skyDome);

const sunLight = new THREE.DirectionalLight(0x9db4ff, 0.85);
sunLight.position.copy(sun).multiplyScalar(120);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(4096, 4096);
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 260;
sunLight.shadow.camera.left = -70;
sunLight.shadow.camera.right = 70;
sunLight.shadow.camera.top = 70;
sunLight.shadow.camera.bottom = -70;
sunLight.shadow.bias = -0.0015;
scene.add(sunLight);
scene.add(sunLight.target);

const hemi = new THREE.HemisphereLight(0x4a5f8a, 0x14141c, 0.9);
scene.add(hemi);

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------
function makeGroundTexture() {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3e4a2c';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 12000; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const v = 50 + Math.random() * 40;
    const g = v + Math.random() * 20;
    ctx.fillStyle = `rgba(${v - 10},${g},${v - 20},${0.06 + Math.random() * 0.1})`;
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  for (let i = 0; i < 16; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 10 + Math.random() * 22;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(70,55,35,0.4)');
    grad.addColorStop(1, 'rgba(70,55,35,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 16; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 3 + Math.random() * 8;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(60,8,8,0.3)');
    grad.addColorStop(1, 'rgba(60,8,8,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 60);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

const groundMat = new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 0.95, metalness: 0.05 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(WORLD_RADIUS + 40, 96), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Driveway / front walk leading to the porch
const pathMat = new THREE.MeshStandardMaterial({ color: 0x8c8a82, roughness: 0.92 });
const frontWalk = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 13), pathMat);
frontWalk.rotation.x = -Math.PI / 2;
frontWalk.position.set(0, 0.015, HOUSE_Z - 6);
frontWalk.receiveShadow = true;
scene.add(frontWalk);

// Picket-fence yard boundary
const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8a6f4e, roughness: 0.85 });
const postMat = new THREE.MeshStandardMaterial({ color: 0x6b5438, roughness: 0.85 });
const fenceGroup = new THREE.Group();
scene.add(fenceGroup);
const fenceSegs = 40;
for (let i = 0; i < fenceSegs; i++) {
  const a = (i / fenceSegs) * Math.PI * 2;
  const rail = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.85, 0.12), fenceMat);
  rail.position.set(Math.cos(a) * (ARENA_RADIUS + 1.5), 0.85, Math.sin(a) * (ARENA_RADIUS + 1.5));
  rail.rotation.y = -a + Math.PI / 2;
  rail.castShadow = true; rail.receiveShadow = true;
  fenceGroup.add(rail);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.25, 0.14), postMat);
  post.position.set(Math.cos(a) * (ARENA_RADIUS + 1.5), 0.62, Math.sin(a) * (ARENA_RADIUS + 1.5));
  post.castShadow = true;
  fenceGroup.add(post);
}

// ---------------------------------------------------------------------------
// The house (home base) + distant neighborhood
// ---------------------------------------------------------------------------
const HOUSE_HW = 5.6, HOUSE_HD = 4.4, HOUSE_WALL_H = 4.8, HOUSE_WALL_T = 0.3;
const ROOF_RISE = 2.6, ROOF_EAVE = 0.3;
// Front-wall gaps (local X ranges, before Z offset): door + two windows
const OPENING_DEFS = [
  { id: 'door', minX: -0.75, maxX: 0.75, minY: 0, maxY: 2.6, maxHealth: 170 },
  { id: 'windowL', minX: -4.3, maxX: -2.9, minY: 1.9, maxY: 3.4, maxHealth: 100 },
  { id: 'windowR', minX: 2.9, maxX: 4.3, minY: 1.9, maxY: 3.4, maxHealth: 100 },
];
const [DOOR_DEF, WIN_L_DEF, WIN_R_DEF] = OPENING_DEFS;

const wallMatH = new THREE.MeshStandardMaterial({ color: 0xc9b89a, roughness: 0.88 });
const gableMat = new THREE.MeshStandardMaterial({ color: 0xc9b89a, roughness: 0.88, side: THREE.DoubleSide });
const interiorWallMat = new THREE.MeshStandardMaterial({ color: 0xe7dcc4, roughness: 0.92 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0xf2ead6, roughness: 0.6 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x5b3b33, roughness: 0.75 });
const chimneyMat = new THREE.MeshStandardMaterial({ color: 0x6b3d33, roughness: 0.85 });
const windowMat = new THREE.MeshStandardMaterial({ color: 0xffe7a3, emissive: 0xffcf6b, emissiveIntensity: 1.1, roughness: 0.4 });
const floorMat = new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 0.8 });
const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xdcd3bd, roughness: 0.9 });

// Builds the house shell (walls with real door/window gaps, a real gable roof
// with eaves + chimney, porch). `interactive` houses (the player's base) get
// floor/ceiling/lamps; distant neighborhood houses are decorative silhouettes
// but share the same shape, since they also need to be searched as a zombie.
function buildHouse(interactive) {
  const house = new THREE.Group();
  const hw = HOUSE_HW, hd = HOUSE_HD, wallH = HOUSE_WALL_H, wallT = HOUSE_WALL_T;

  function wallBox(width, height, depth, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wallMatH);
    m.position.set(x, y, z);
    house.add(m);
    return m;
  }

  // Front wall: solid segments flanking the door + two windows (derived from
  // OPENING_DEFS so the visual wall and the collision gaps never drift apart)
  wallBox(WIN_L_DEF.minX + hw, wallH, wallT, (-hw + WIN_L_DEF.minX) / 2, wallH / 2, -hd);
  wallBox(DOOR_DEF.minX - WIN_L_DEF.maxX, wallH, wallT, (WIN_L_DEF.maxX + DOOR_DEF.minX) / 2, wallH / 2, -hd);
  wallBox(WIN_R_DEF.minX - DOOR_DEF.maxX, wallH, wallT, (DOOR_DEF.maxX + WIN_R_DEF.minX) / 2, wallH / 2, -hd);
  wallBox(hw - WIN_R_DEF.maxX, wallH, wallT, (WIN_R_DEF.maxX + hw) / 2, wallH / 2, -hd);
  // Back + side walls: fully solid
  wallBox(hw * 2, wallH, wallT, 0, wallH / 2, hd);
  wallBox(wallT, wallH, hd * 2, -hw, wallH / 2, 0);
  wallBox(wallT, wallH, hd * 2, hw, wallH / 2, 0);

  // Gable roof: two sloped panels meeting at a ridge, with triangular gable
  // ends front and back — reads as an actual roof, not a 4-sided pyramid cap.
  const roofHalfSpan = hw + ROOF_EAVE;
  const roofDepth = hd * 2 + ROOF_EAVE * 2;
  for (const sign of [1, -1]) {
    const eave = new THREE.Vector3(sign * roofHalfSpan, wallH, 0);
    const ridge = new THREE.Vector3(0, wallH + ROOF_RISE, 0);
    const dir = new THREE.Vector3().subVectors(ridge, eave);
    const mid = new THREE.Vector3().addVectors(eave, ridge).multiplyScalar(0.5);
    const slope = new THREE.Mesh(new THREE.BoxGeometry(dir.length(), 0.15, roofDepth), roofMat);
    slope.position.set(mid.x, mid.y, 0);
    slope.rotation.z = Math.atan2(dir.y, dir.x);
    house.add(slope);
  }
  for (const z of [-hd - 0.01, hd + 0.01]) {
    const shape = new THREE.Shape();
    shape.moveTo(-hw, 0);
    shape.lineTo(hw, 0);
    shape.lineTo(0, ROOF_RISE);
    shape.closePath();
    const gableEnd = new THREE.Mesh(new THREE.ShapeGeometry(shape), gableMat);
    gableEnd.position.set(0, wallH, z);
    house.add(gableEnd);
  }
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.9, 0.6), chimneyMat);
  chimney.position.set(hw * 0.42, wallH + ROOF_RISE * 0.55 + 0.95, hd * 0.3);
  house.add(chimney);

  const porchFloor = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 2.6), trimMat);
  porchFloor.position.set(0, 0.1, -hd - 1.3);
  house.add(porchFloor);

  const postGeo = new THREE.CylinderGeometry(0.1, 0.1, 2.8, 8);
  for (const x of [-2.5, 2.5]) {
    const p = new THREE.Mesh(postGeo, trimMat);
    p.position.set(x, 1.5, -hd - 2.4);
    house.add(p);
  }
  const porchRoof = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.15, 2.8), trimMat);
  porchRoof.position.set(0, 2.9, -hd - 1.3);
  house.add(porchRoof);

  // Decorative (non-breachable) side windows
  const sideWinGeo = new THREE.BoxGeometry(0.08, 1.2, 1.2);
  for (const x of [-hw - 0.01, hw + 0.01]) {
    const w = new THREE.Mesh(sideWinGeo, windowMat);
    w.position.set(x, 2.6, 0.5);
    house.add(w);
  }

  house.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });

  if (interactive) {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 0.1, hd * 2), floorMat);
    floor.position.y = 0.03;
    floor.receiveShadow = true;
    house.add(floor);

    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 0.12, hd * 2), ceilingMat);
    ceiling.position.y = wallH - 0.06;
    ceiling.receiveShadow = true;
    house.add(ceiling);

    // Interior partition wall — splits the house into a front living room
    // (door + both windows) and a back bedroom, joined by a doorway.
    wallBox(hw - ROOM_DOORWAY_HALF, wallH, wallT, -(hw + ROOM_DOORWAY_HALF) / 2, wallH / 2, ROOM_PARTITION_Z);
    wallBox(hw - ROOM_DOORWAY_HALF, wallH, wallT, (hw + ROOM_DOORWAY_HALF) / 2, wallH / 2, ROOM_PARTITION_Z);
    const doorTrim = new THREE.Mesh(new THREE.BoxGeometry(ROOM_DOORWAY_HALF * 2 + 0.1, 0.1, wallT + 0.04), trimMat);
    doorTrim.position.set(0, wallH - 0.5, ROOM_PARTITION_Z);
    house.add(doorTrim);

    // Simple furniture so each room reads as its own space
    const bedFrameMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.85 });
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x7a8aa0, roughness: 0.8 });
    const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.35, 2.6), bedFrameMat);
    bedFrame.position.set(hw - 1.3, 0.2, ROOM_PARTITION_Z + (hd - ROOM_PARTITION_Z) / 2 + 0.3);
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.25, 2.5), bedMat);
    mattress.position.set(bedFrame.position.x, 0.5, bedFrame.position.z);
    house.add(bedFrame, mattress);

    const tableMat = new THREE.MeshStandardMaterial({ color: 0x5a4332, roughness: 0.8 });
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.42, 0.65), tableMat);
    table.position.set(-hw + 1.0, 0.21, -1.4);
    house.add(table);

    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff3cf, emissive: 0xffd98a, emissiveIntensity: 2 });
    function hangLamp(x, z, intensity, dist) {
      const lamp = new THREE.PointLight(0xffdca8, intensity, dist, 1.4);
      lamp.position.set(x, wallH - 0.5, z);
      house.add(lamp);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), bulbMat);
      bulb.position.copy(lamp.position);
      house.add(bulb);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
      cord.position.set(x, wallH - 0.25, z);
      house.add(cord);
    }
    hangLamp(0, -0.6, 7, 15); // living room
    hangLamp(0, -hd + 1.6, 4.5, 11); // living room, near the door
    hangLamp(hw - 1.3, ROOM_PARTITION_Z + 1.3, 5, 10); // bedroom

    const fillLight = new THREE.PointLight(0xfff0d8, 1.4, 13, 1.2);
    fillLight.position.set(0, wallH - 1, -0.6);
    house.add(fillLight);
  }

  return house;
}

function buildPlanks(width, height) {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5a36, roughness: 0.88 });
  const count = 4;
  const plankH = (height / count) * 1.2;
  for (let i = 0; i < count; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(width * 0.96, plankH * 0.82, 0.08), woodMat);
    plank.position.y = -height / 2 + plankH * (i + 0.5);
    plank.rotation.z = (Math.random() - 0.5) * 0.05;
    plank.castShadow = true; plank.receiveShadow = true;
    group.add(plank);
  }
  return group;
}

const obstacles = [];
function addObstacle(mesh, radius) {
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  obstacles.push({ mesh, radius, pos: mesh.position });
}

// Solid wall collision (always active) + the breachable openings (boarded/broken).
// Derived from OPENING_DEFS directly so the collision gaps can never drift out
// of sync with the visual wall gaps buildHouse() draws.
const ROOM_PARTITION_Z = 2.0; // local z of the interior wall splitting living room / bedroom
const ROOM_DOORWAY_HALF = 0.6;
const HOUSE_SOLID_WALLS = [
  { minX: -HOUSE_HW, maxX: WIN_L_DEF.minX, minZ: HOUSE_Z - HOUSE_HD - HOUSE_WALL_T, maxZ: HOUSE_Z - HOUSE_HD + HOUSE_WALL_T },
  { minX: WIN_L_DEF.maxX, maxX: DOOR_DEF.minX, minZ: HOUSE_Z - HOUSE_HD - HOUSE_WALL_T, maxZ: HOUSE_Z - HOUSE_HD + HOUSE_WALL_T },
  { minX: DOOR_DEF.maxX, maxX: WIN_R_DEF.minX, minZ: HOUSE_Z - HOUSE_HD - HOUSE_WALL_T, maxZ: HOUSE_Z - HOUSE_HD + HOUSE_WALL_T },
  { minX: WIN_R_DEF.maxX, maxX: HOUSE_HW, minZ: HOUSE_Z - HOUSE_HD - HOUSE_WALL_T, maxZ: HOUSE_Z - HOUSE_HD + HOUSE_WALL_T },
  { minX: -HOUSE_HW, maxX: HOUSE_HW, minZ: HOUSE_Z + HOUSE_HD - HOUSE_WALL_T, maxZ: HOUSE_Z + HOUSE_HD + HOUSE_WALL_T },
  { minX: -HOUSE_HW - HOUSE_WALL_T, maxX: -HOUSE_HW + HOUSE_WALL_T, minZ: HOUSE_Z - HOUSE_HD, maxZ: HOUSE_Z + HOUSE_HD },
  { minX: HOUSE_HW - HOUSE_WALL_T, maxX: HOUSE_HW + HOUSE_WALL_T, minZ: HOUSE_Z - HOUSE_HD, maxZ: HOUSE_Z + HOUSE_HD },
  // Interior partition wall (living room / bedroom), with a doorway gap
  { minX: -HOUSE_HW, maxX: -ROOM_DOORWAY_HALF, minZ: HOUSE_Z + ROOM_PARTITION_Z - HOUSE_WALL_T, maxZ: HOUSE_Z + ROOM_PARTITION_Z + HOUSE_WALL_T },
  { minX: ROOM_DOORWAY_HALF, maxX: HOUSE_HW, minZ: HOUSE_Z + ROOM_PARTITION_Z - HOUSE_WALL_T, maxZ: HOUSE_Z + ROOM_PARTITION_Z + HOUSE_WALL_T },
];
const HOUSE_OPENINGS = [];

function collideHouseWalls(pos, radius) {
  const boxes = HOUSE_SOLID_WALLS;
  for (const w of boxes) {
    const cx = THREE.MathUtils.clamp(pos.x, w.minX, w.maxX);
    const cz = THREE.MathUtils.clamp(pos.z, w.minZ, w.maxZ);
    const dx = pos.x - cx, dz = pos.z - cz;
    const distSq = dx * dx + dz * dz;
    if (distSq < radius * radius) {
      const dist = Math.sqrt(distSq) || 0.0001;
      const push = radius - dist;
      pos.x += (dx / dist) * push;
      pos.z += (dz / dist) * push;
    }
  }
  for (const o of HOUSE_OPENINGS) {
    if (o.state !== 'boarded') continue;
    const w = o.box;
    const cx = THREE.MathUtils.clamp(pos.x, w.minX, w.maxX);
    const cz = THREE.MathUtils.clamp(pos.z, w.minZ, w.maxZ);
    const dx = pos.x - cx, dz = pos.z - cz;
    const distSq = dx * dx + dz * dz;
    if (distSq < radius * radius) {
      const dist = Math.sqrt(distSq) || 0.0001;
      const push = radius - dist;
      pos.x += (dx / dist) * push;
      pos.z += (dz / dist) * push;
    }
  }
}

function breakOpening(o) {
  if (o.state === 'broken') return;
  o.state = 'broken';
  o.health = 0;
  o.boards.visible = false;
  o.bar.visible = false;
  playZombieDeath(o.worldCenter);
  addKillFeed(`The ${o.label} has been breached!`, '#ff8a6b');
}

function repairOpening(o, amount) {
  const wasBroken = o.state === 'broken';
  o.health = Math.min(o.maxHealth, o.health + amount);
  if (o.health > 0 && wasBroken) {
    o.state = 'boarded';
    o.boards.visible = true;
    o.bar.visible = true;
  }
  o.bar.userData.draw(o.health / o.maxHealth, '#d8a24a');
}

function damageOpening(o, amount) {
  if (o.state === 'broken') return;
  o.health -= amount;
  o.bar.userData.draw(Math.max(0, o.health / o.maxHealth), '#d8a24a');
  if (o.health <= 0) breakOpening(o);
}

// Horizontal-only distance — interact range shouldn't shrink just because the
// player's eye height differs from a ground-level prop or a high window.
function distXZ(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// Recovers an AI entity whose position has gone non-finite (e.g. diverged
// from being wedged into a collision corner across many frames) back to a
// safe spot, rather than leaving it permanently invisible and feeding NaN
// into downstream math (distances, audio panning, etc).
function recoverIfCorrupted(pos, fallback) {
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
    pos.copy(fallback);
    return true;
  }
  return false;
}

function nearestOpening(fromPos, maxDist) {
  let best = null, bestDist = Infinity;
  for (const o of HOUSE_OPENINGS) {
    const d = distXZ(fromPos, o.worldCenter);
    if (d < maxDist && d < bestDist) { bestDist = d; best = o; }
  }
  return best;
}

function isInsideHouse(pos) {
  return pos.z > HOUSE_Z - HOUSE_HD;
}

function showInteractPrompt(text, pct) {
  const el = document.getElementById('interact-prompt');
  el.style.display = 'block';
  el.innerHTML = pct == null
    ? `<b>${text}</b>`
    : `<b>${text}</b><div class="bar-track"><div class="bar-fill" style="width:${Math.round(pct * 100)}%"></div></div>`;
}
function hideInteractPrompt() {
  document.getElementById('interact-prompt').style.display = 'none';
}

// The door works like a lock: free to lock/unlock from inside, but once
// locked from the outside you need the house key to get back in. Windows
// are simpler — just pry the boards off or nail them back up.
function nearestInteractableIsAmmo(playerPos, o) {
  const dAmmo = distXZ(playerPos, AMMO_STATION.position);
  if (dAmmo > AMMO_STATION.radius) return false;
  if (!o) return true;
  return dAmmo <= distXZ(playerPos, o.worldCenter);
}

function tryInteract() {
  if (!player.alive || !controls.isLocked) return;
  const playerPos = controls.getObject().position;
  const o = nearestOpening(playerPos, 2.3);
  if (nearestInteractableIsAmmo(playerPos, o)) { resupplyAmmo(); return; }
  // A damaged opening (broken, or still boarded but battered) is repaired by
  // holding E, not by tapping it — tapping here would toggle it, confusingly
  // resetting progress on a still-boarded-but-cracked board.
  if (!o || o.health < o.maxHealth) return;

  if (o.id === 'door') {
    const inside = isInsideHouse(playerPos);
    if (o.state === 'boarded') {
      if (inside) {
        o.state = 'open'; o.boards.visible = false; o.bar.visible = false;
        addKillFeed('You unlocked the door', '#bcd9ff'); playReloadClick(0);
      } else if (player.hasKey) {
        o.state = 'open'; o.boards.visible = false; o.bar.visible = false;
        addKillFeed('You used the key to unlock the door', '#ffe066'); playReloadClick(0); playReloadClick(0.12);
      } else {
        addKillFeed('The door is locked — find a key', '#ff8a6b');
      }
    } else if (o.state === 'open' && inside) {
      o.state = 'boarded'; o.health = o.maxHealth; o.boards.visible = true; o.bar.visible = true;
      o.bar.userData.draw(1, '#d8a24a');
      addKillFeed('You locked the door', '#bcd9ff'); playReloadClick(0);
    }
    return;
  }

  if (o.state === 'boarded') {
    o.state = 'open'; o.boards.visible = false; o.bar.visible = false;
    addKillFeed(`You pried open the ${o.label}`, '#bcd9ff'); playReloadClick(0);
  } else if (o.state === 'open') {
    o.state = 'boarded'; o.health = o.maxHealth; o.boards.visible = true; o.bar.visible = true;
    o.bar.userData.draw(1, '#d8a24a');
    addKillFeed(`You boarded up the ${o.label}`, '#bcd9ff'); playReloadClick(0);
  }
}

function updateInteractPrompt(dt) {
  if (!player.alive || !controls.isLocked) { hideInteractPrompt(); return; }
  const playerPos = controls.getObject().position;
  const o = nearestOpening(playerPos, 2.3);

  if (nearestInteractableIsAmmo(playerPos, o)) {
    showInteractPrompt(stationNeedsAmmo() ? '[E] Resupply Ammo' : 'Ammo crate (full)', null);
    return;
  }
  if (!o) {
    const onDeck = isOverPlatform(playerPos) && playerPos.y > ROOF_Y + STAND_HEIGHT - 0.5;
    if (isOnLadder(playerPos) && !onDeck) {
      showInteractPrompt('Hold [Space] to climb', null);
    } else {
      hideInteractPrompt();
    }
    return;
  }

  if (o.health < o.maxHealth) {
    showInteractPrompt(`Hold [E] to repair the ${o.label}`, o.health / o.maxHealth);
    if (keys['KeyE']) {
      repairOpening(o, 55 * dt);
      if (Math.random() < dt * 6) playReloadClick(0);
    }
    return;
  }

  if (o.id === 'door') {
    const inside = isInsideHouse(playerPos);
    if (o.state === 'boarded') {
      showInteractPrompt(inside ? '[E] Unlock Door' : (player.hasKey ? '[E] Unlock Door (Key)' : 'Door is locked — find a key'), null);
    } else {
      showInteractPrompt(inside ? '[E] Lock Door' : 'Door is unlocked', null);
    }
    return;
  }

  showInteractPrompt(o.state === 'boarded' ? `[E] Pry Open ${o.label}` : `[E] Board Up ${o.label}`, null);
}

const playerHouse = buildHouse(true);
playerHouse.position.set(0, 0, HOUSE_Z);
scene.add(playerHouse);

for (const def of OPENING_DEFS) {
  const width = def.maxX - def.minX;
  const height = def.maxY - def.minY;
  const centerX = (def.minX + def.maxX) / 2;
  const centerY = (def.minY + def.maxY) / 2;
  const worldCenter = new THREE.Vector3(centerX, centerY, HOUSE_Z - HOUSE_HD);

  const boards = buildPlanks(width, height);
  boards.position.set(centerX, centerY, HOUSE_Z - HOUSE_HD - 0.12);
  scene.add(boards);

  const bar = makeHealthBarSprite();
  bar.position.set(centerX, def.maxY + 0.35, HOUSE_Z - HOUSE_HD);
  bar.userData.draw(1, '#d8a24a');
  scene.add(bar);

  HOUSE_OPENINGS.push({
    id: def.id,
    label: def.id === 'door' ? 'door' : 'window',
    worldCenter, boards, bar,
    health: def.maxHealth, maxHealth: def.maxHealth,
    state: 'boarded',
    box: { minX: def.minX, maxX: def.maxX, minZ: HOUSE_Z - HOUSE_HD - HOUSE_WALL_T, maxZ: HOUSE_Z - HOUSE_HD + HOUSE_WALL_T },
  });
}

// ---------------------------------------------------------------------------
// The neighborhood: a street grid of houses beyond the yard. You only get to
// roam it once you've turned — that's where the survivors are hiding.
// ---------------------------------------------------------------------------
const neighborhoodHouses = [];
{
  const spacing = 32;
  const roadCanvas = document.createElement('canvas');
  roadCanvas.width = 256; roadCanvas.height = 64;
  const rg = roadCanvas.getContext('2d');
  rg.fillStyle = '#2e3033'; rg.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 1500; i++) { rg.fillStyle = `rgba(${90 + Math.random() * 40},${90 + Math.random() * 40},${95 + Math.random() * 40},0.18)`; rg.fillRect(Math.random() * 256, Math.random() * 64, 2, 2); }
  rg.fillStyle = '#c9b64a';
  for (let x = 0; x < 256; x += 64) rg.fillRect(x + 8, 30, 36, 4);
  const roadTex = new THREE.CanvasTexture(roadCanvas);
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.colorSpace = THREE.SRGBColorSpace;
  roadTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92 });
  const roadGeo = new THREE.PlaneGeometry(spacing, 9);
  const roads = new THREE.Group();
  for (let k = -3; k <= 3; k++) {
    for (let j = -3; j <= 3; j++) {
      const mid = (k + 0.5) * spacing;            // street lines sit halfway between house rows
      const cell = j * spacing;
      for (const [x, z, rot] of [[cell, mid, 0], [mid, cell, Math.PI / 2]]) {
        if (Math.hypot(x, z) < 44 || Math.hypot(x, z) > WORLD_RADIUS) continue;
        const r = new THREE.Mesh(roadGeo, roadMat);
        r.rotation.set(-Math.PI / 2, 0, rot);
        r.position.set(x, 0.03, z);
        r.receiveShadow = true;
        roads.add(r);
      }
    }
  }
  scene.add(roads);

  for (let gx = -3; gx <= 3; gx++) {
    for (let gz = -3; gz <= 3; gz++) {
      const x = gx * spacing + (Math.random() - 0.5) * 5, z = gz * spacing + (Math.random() - 0.5) * 5;
      if (Math.hypot(x, z) < 50 || Math.hypot(x, z) > WORLD_RADIUS) continue;
      const h = buildHouse(false);
      h.traverse(m => { if (m.isMesh) m.castShadow = false; });
      h.scale.setScalar(0.9 + Math.random() * 0.2);
      h.position.set(x, 0, z);
      h.rotation.y = Math.floor(Math.random() * 4) * (Math.PI / 2);
      addObstacle(h, 6.6);
      neighborhoodHouses.push({ x, z });
      if (Math.random() < 0.45) {
        const t = buildTree();
        t.position.set(x + (Math.random() - 0.5) * 16, 0, z + (Math.random() > 0.5 ? 9 : -9));
        t.traverse(m => { if (m.isMesh) m.castShadow = false; });
        scene.add(t);
      }
      if (Math.random() < 0.3) {
        const c = buildCar();
        c.traverse(m => { if (m.isMesh) m.castShadow = false; });
        c.position.set(x + (Math.random() > 0.5 ? 12 : -12), 0, z + (Math.random() - 0.5) * 10);
        c.rotation.y = Math.random() * Math.PI;
        addObstacle(c, 2.4);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Street lamps: glowing heads everywhere, with a small pool of real lights that
// hops to whichever lamps are nearest the camera (dozens of true lights is too heavy).
// ---------------------------------------------------------------------------
const streetLamps = [];
{
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.6 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffc878, emissiveIntensity: 5 });
  const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 6, 8);
  const armGeo = new THREE.BoxGeometry(1.4, 0.1, 0.12);
  const headGeo = new THREE.BoxGeometry(0.7, 0.18, 0.4);
  const addLamp = (x, z, ang) => {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.y = 3;
    const arm = new THREE.Mesh(armGeo, poleMat); arm.position.set(0.65, 6, 0);
    const head = new THREE.Mesh(headGeo, headMat); head.position.set(1.25, 5.92, 0);
    g.add(pole, arm, head);
    g.position.set(x, 0, z); g.rotation.y = ang;
    scene.add(g);
    streetLamps.push(new THREE.Vector3(x + Math.cos(ang) * 1.25, 5.8, z - Math.sin(ang) * 1.25));
  };
  for (let k = -3; k <= 2; k++) {
    for (let j = -3; j <= 2; j++) {
      const x = (k + 0.5) * 32, z = (j + 0.5) * 32;
      if (Math.hypot(x, z) < 44 || Math.hypot(x, z) > WORLD_RADIUS) continue;
      addLamp(x + 5.5, z + 5.5, Math.PI * 1.25);
    }
  }
  for (const [x, z, a] of [[10, 12, Math.PI], [-11, 12, 0], [15, -6, Math.PI], [-15, -6, 0], [8, 36, Math.PI], [-8, 36, 0]]) addLamp(x, z, a);
}
const lampLights = [];
for (let i = 0; i < 8; i++) {
  const l = new THREE.PointLight(0xffd29a, 22, 26, 1.5);
  l.position.set(0, -50, 0);
  scene.add(l);
  lampLights.push(l);
}
let lampTick = 0;
function updateLampLights(dt) {
  lampTick -= dt;
  if (lampTick > 0) return;
  lampTick = 0.4;
  const p = camera.position;
  const nearest = streetLamps.map(v => [v.distanceToSquared(p), v]).sort((a, b) => a[0] - b[0]).slice(0, lampLights.length);
  lampLights.forEach((l, i) => { if (nearest[i]) l.position.copy(nearest[i][1]); });
}

// ---------------------------------------------------------------------------
// Yard props / cover
// ---------------------------------------------------------------------------
function buildCar() {
  const car = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7a1f1f, roughness: 0.4, metalness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd1e0, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.6 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 1.8), bodyMat);
  base.position.y = 0.75;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 1.7), glassMat);
  cabin.position.set(-0.2, 1.5, 0);
  car.add(base, cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 12);
  for (const [x, z] of [[-1.4, -0.9], [1.4, -0.9], [-1.4, 0.9], [1.4, 0.9]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.4, z);
    car.add(wheel);
  }
  car.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return car;
}

function buildTree() {
  const tree = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 });
  const leavesMat = new THREE.MeshStandardMaterial({ color: 0x3c4a24, roughness: 0.85 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.6, 8), trunkMat);
  trunk.position.y = 1.3;
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), leavesMat);
  leaves.position.y = 3.1;
  tree.add(trunk, leaves);
  tree.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return tree;
}

function buildTrashCan() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x4d5a4d, roughness: 0.7, metalness: 0.3 });
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.35, 1.1, 10), mat);
  can.position.y = 0.55;
  can.castShadow = true; can.receiveShadow = true;
  return can;
}

function buildMailbox() {
  const group = new THREE.Group();
  const pMat = new THREE.MeshStandardMaterial({ color: 0x6b5438, roughness: 0.8 });
  const bMat = new THREE.MeshStandardMaterial({ color: 0x3a5a3a, roughness: 0.6, metalness: 0.3 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6), pMat);
  post.position.y = 0.55;
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.6), bMat);
  box.position.y = 1.15;
  group.add(post, box);
  group.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return group;
}

const propBuilders = [
  { build: buildCar, radius: 2.4 },
  { build: buildTree, radius: 1.3 },
  { build: buildTrashCan, radius: 0.55 },
  { build: buildMailbox, radius: 0.4 },
];
for (let i = 0; i < 9; i++) {
  const ang = randomYardAngle();
  const r = 9 + Math.random() * (ARENA_RADIUS - 15);
  const pick = propBuilders[i % propBuilders.length];
  const prop = pick.build();
  prop.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
  prop.rotation.y = Math.random() * Math.PI * 2;
  addObstacle(prop, pick.radius);
}

// ---------------------------------------------------------------------------
// Ammo resupply station
// ---------------------------------------------------------------------------
function buildAmmoStation() {
  const group = new THREE.Group();
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x5a4328, roughness: 0.82 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x3f4a3f, roughness: 0.5, metalness: 0.6 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xd8c84a, roughness: 0.6, metalness: 0.3 });

  const crate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.85, 1.1), crateMat);
  crate.position.y = 0.42;
  group.add(crate);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.1, 1.12), stripeMat);
  stripe.position.y = 0.42;
  group.add(stripe);

  const box1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.36), metalMat);
  box1.position.set(-0.18, 1.02, 0.08);
  box1.rotation.y = 0.3;
  const box2 = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.34), metalMat);
  box2.position.set(0.17, 0.98, -0.14);
  box2.rotation.y = -0.4;
  group.add(box1, box2);

  const glow = new THREE.PointLight(0x7fd1ff, 1.4, 4.5);
  glow.position.set(0, 1.2, 0);
  group.add(glow);

  group.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return group;
}

const ammoStationMesh = buildAmmoStation();
ammoStationMesh.position.set(HOUSE_HW + 0.5, 0, HOUSE_Z - HOUSE_HD - 4.5);
addObstacle(ammoStationMesh, 0.95);
const AMMO_STATION = { position: ammoStationMesh.position, radius: 2.3 };

function relocateAmmoStation() {
  const ang = randomYardAngle();
  const r = 8 + Math.random() * (ARENA_RADIUS - 14);
  ammoStationMesh.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
}

function stationNeedsAmmo() {
  return Object.values(WEAPONS).some(w => w.kind === 'ranged' && (w.ammo < w.magSize || w.reserve < w.maxReserve))
    || player.grenades < GRENADE_MAX;
}

function resupplyAmmo() {
  if (!stationNeedsAmmo()) return;
  for (const w of Object.values(WEAPONS)) {
    if (w.kind !== 'ranged') continue;
    w.ammo = w.magSize;
    w.reserve = w.maxReserve;
  }
  player.grenades = GRENADE_MAX;
  addKillFeed('Resupplied ammo and grenades', '#bcd9ff');
  playPickup();
  updateHUD();
}

// ---------------------------------------------------------------------------
// Roof platform + ladder (lets the player and two rooftop allies fight from above)
// ---------------------------------------------------------------------------
const ROOF_Y = HOUSE_WALL_H;
const LADDER_X = HOUSE_HW + 0.35;
const LADDER_Z = HOUSE_Z;
const PLATFORM_X_MIN = HOUSE_HW - 0.2;
const PLATFORM_Z_MIN = HOUSE_Z - 2.3;
const PLATFORM_Z_MAX = HOUSE_Z + 2.3;
const PLATFORM_CENTER_X = HOUSE_HW + 1.3;

function buildRoofStructure() {
  const group = new THREE.Group();
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x6b5a42, roughness: 0.85 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x4a3c2a, roughness: 0.8 });
  const ladderMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.55, metalness: 0.5 });

  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.15, 4.6), deckMat);
  deck.position.set(PLATFORM_CENTER_X, ROOF_Y, HOUSE_Z);
  group.add(deck);

  // support posts under the deck
  for (const dz of [-2.0, 2.0]) {
    for (const dx of [-1.1, 1.1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, ROOF_Y, 6), railMat);
      post.position.set(PLATFORM_CENTER_X + dx, ROOF_Y / 2, HOUSE_Z + dz);
      group.add(post);
    }
  }

  // railing around the outer three edges
  const farX = PLATFORM_CENTER_X + 1.3;
  const railGeoLong = new THREE.BoxGeometry(0.08, 0.9, 4.6);
  const rail = new THREE.Mesh(railGeoLong, railMat);
  rail.position.set(farX, ROOF_Y + 0.5, HOUSE_Z);
  group.add(rail);
  const railGeoShort = new THREE.BoxGeometry(2.7, 0.9, 0.08);
  for (const dz of [-2.3, 2.3]) {
    const r2 = new THREE.Mesh(railGeoShort, railMat);
    r2.position.set(PLATFORM_CENTER_X, ROOF_Y + 0.5, HOUSE_Z + dz);
    group.add(r2);
  }

  // ladder on the exterior wall face
  for (const dz of [-0.35, 0.35]) {
    const rail3 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, ROOF_Y, 6), ladderMat);
    rail3.position.set(LADDER_X, ROOF_Y / 2, LADDER_Z + dz);
    group.add(rail3);
  }
  const rungCount = Math.floor(ROOF_Y / 0.32);
  for (let i = 1; i < rungCount; i++) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.78, 6), ladderMat);
    rung.rotation.z = Math.PI / 2;
    rung.position.set(LADDER_X, i * 0.32, LADDER_Z);
    group.add(rung);
  }

  group.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return group;
}
scene.add(buildRoofStructure());

function isOnLadder(pos) {
  return Math.abs(pos.x - LADDER_X) < 0.8 && Math.abs(pos.z - LADDER_Z) < 0.8;
}
function isOverPlatform(pos) {
  return pos.x > PLATFORM_X_MIN && pos.z > PLATFORM_Z_MIN && pos.z < PLATFORM_Z_MAX;
}

// ---------------------------------------------------------------------------
// Rooftop allies — stationary snipers covering the yard from above
// ---------------------------------------------------------------------------
const rooftopAllies = [];
function spawnRooftopAlly(z) {
  const root = buildCharacter('survivor');
  root.position.set(PLATFORM_CENTER_X, ROOF_Y + 0.08, z);
  root.rotation.y = Math.PI / 2; // face outward over the yard
  scene.add(root);
  rooftopAllies.push({ root, alive: true, maxHealth: 120, health: 120, fireCooldown: Math.random() * 0.5, walkT: Math.random() * 10 });
}
function updateRooftopAlly(ally, dt) {
  if (player.turned) {
    allyEngagePlayer(ally, dt, { turnSpeed: 0.1, range: 32, muzzleY: 1.4, cooldownMin: 0.9, cooldownJitter: 0.5, dmgMin: 6, dmgJitter: 5, vol: 0.4, pitch: 1.4 });
    ally.walkT += dt * 0.2;
    animateWalk(ally.root, ally.walkT, 0.2);
    return;
  }
  let nearest = null, nearestDist = Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = ally.root.position.distanceTo(e.root.position);
    if (d < nearestDist) { nearestDist = d; nearest = e; }
  }
  if (nearest && nearestDist < 30) {
    const facing = nearest.root.position.clone().sub(ally.root.position);
    const lookAngle = Math.atan2(facing.x, facing.z);
    ally.root.rotation.y = THREE.MathUtils.lerp(ally.root.rotation.y, lookAngle, 0.1);
    ally.fireCooldown -= dt;
    if (ally.fireCooldown <= 0) {
      ally.fireCooldown = 1.0 + Math.random() * 0.5;
      const from = ally.root.position.clone().add(new THREE.Vector3(0, 1.4, 0));
      const to = nearest.root.position.clone().add(new THREE.Vector3(0, 1.1, 0));
      spawnTracer(from, to, 0x7cf4ff);
      playGunshot(from, 0.4, 1.4);
      damageEnemy(nearest, 9 + Math.random() * 5);
    }
  }
  ally.walkT += dt * 0.3;
  animateWalk(ally.root, ally.walkT, 0.3);
}

function collideObstacles(pos, radius) {
  for (const o of obstacles) {
    const dx = pos.x - o.pos.x, dz = pos.z - o.pos.z;
    const d = Math.hypot(dx, dz);
    const min = o.radius + radius;
    if (d < min && d > 0.0001) {
      const push = (min - d);
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    }
  }
  const r = Math.hypot(pos.x, pos.z);
  const limit = player.turned ? WORLD_RADIUS : ARENA_RADIUS - 1.5;
  if (r > limit) {
    const s = limit / r;
    pos.x *= s; pos.z *= s;
  }
}

// ---------------------------------------------------------------------------
// Player / controls
// ---------------------------------------------------------------------------
const STAND_HEIGHT = 1.7, CROUCH_HEIGHT = 1.05;
const controls = new PointerLockControls(camera, document.body);
controls.minPolarAngle = 0.35; // can't tip the view upside down — about 20° from straight up
controls.maxPolarAngle = Math.PI - 0.35; // …or straight down
scene.add(controls.getObject());
controls.getObject().position.set(0, STAND_HEIGHT, PLAYER_SPAWN_Z);

const player = {
  health: 100, maxHealth: 100,
  shield: 0, maxShield: 60,
  stamina: 100, maxStamina: 100,
  velocity: new THREE.Vector3(),
  canJump: true,
  speed: 5.6,
  sprinting: false,
  crouching: false,
  sliding: false,
  slideTimer: 0,
  slideDir: new THREE.Vector3(),
  aiming: false,
  eyeHeight: STAND_HEIGHT,
  alive: true,
  score: 0,
  radius: 0.5,
  hasKey: false,
  turned: false,
  grenades: 2,
};

const SLIDE_DURATION = 0.55, SLIDE_SPEED = 11;

const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyR') tryReload();
  if (e.code === 'CapsLock') {
    if (!player.crouching && player.sprinting && !player.sliding) {
      const dir = new THREE.Vector3(player.velocity.x, 0, player.velocity.z);
      if (dir.lengthSq() < 0.5) { camera.getWorldDirection(dir); dir.y = 0; }
      dir.normalize();
      player.sliding = true;
      player.slideTimer = SLIDE_DURATION;
      player.slideDir = dir;
      player.crouching = true;
      playFootstep();
    } else {
      player.crouching = !player.crouching;
      player.sliding = false;
    }
  }
  if (e.code === 'KeyE') tryInteract();
  if (e.code === 'KeyG') throwGrenade();
  if (e.code === 'KeyF') tryInfect();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
let gameStarted = false;

startBtn.addEventListener('click', () => {
  ensureAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  controls.lock();
});
controls.addEventListener('lock', () => {
  overlay.classList.add('hidden');
  if (!gameStarted) { gameStarted = true; startWave(1); }
});
controls.addEventListener('unlock', () => {
  if (player.alive) overlay.classList.remove('hidden');
});
document.addEventListener('pointerlockerror', () => {
  overlay.classList.remove('hidden');
  const note = document.getElementById('lock-note');
  if (note) note.style.display = 'block';
});

// ---------------------------------------------------------------------------
// Weapons (view models: knife, pistol, rifle)
// ---------------------------------------------------------------------------
const WEAPON_VIEWMODELS = {};

// First-person hands — so the view-model reads as a human holding a weapon,
// not a gun floating in space. Materials are tracked so turnIntoZombie() can
// re-tint them sickly without swapping to monster claws (you're still human).
const handMats = [];
function buildViewHand(gripLocal) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xd9a876, roughness: 0.75 });
  handMats.push(mat);
  const group = new THREE.Group();
  group.position.copy(gripLocal);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.052, 8, 6), mat);
  group.add(hand);
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.28, 8), mat);
  forearm.rotation.x = Math.PI / 2;
  forearm.position.z = 0.16;
  group.add(forearm);
  group.traverse(m => { if (m.isMesh) m.castShadow = true; });
  return group;
}

function buildRifleViewModel() {
  const group = new THREE.Group();
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.35, metalness: 0.8 });
  const gunAccent = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5, metalness: 0.6 });
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.13, 0.62), gunMat);
  gunBody.position.set(0, 0, -0.1);
  const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 10), gunAccent);
  gunBarrel.rotation.x = Math.PI / 2;
  gunBarrel.position.set(0, 0.015, -0.5);
  const gunMag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.1), gunAccent);
  gunMag.position.set(0, -0.15, -0.02);
  const gunStock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.22), gunAccent);
  gunStock.position.set(0, -0.01, 0.28);
  const scopeMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.4, metalness: 0.7 });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x3c5a6b, emissive: 0x1c2f38, roughness: 0.2, metalness: 0.3 });
  const scopeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.26, 10), scopeMat);
  scopeTube.rotation.x = Math.PI / 2;
  scopeTube.position.set(0, 0.095, -0.12);
  const scopeFrontLens = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 10), lensMat);
  scopeFrontLens.rotation.x = Math.PI / 2;
  scopeFrontLens.position.set(0, 0.095, -0.25);
  const scopeRearLens = scopeFrontLens.clone();
  scopeRearLens.position.z = 0.01;
  const scopeMountF = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), scopeMat);
  scopeMountF.position.set(0, 0.045, -0.2);
  const scopeMountR = scopeMountF.clone();
  scopeMountR.position.z = -0.04;
  group.add(scopeTube, scopeFrontLens, scopeRearLens, scopeMountF, scopeMountR);

  group.add(gunBody, gunBarrel, gunMag, gunStock);
  group.add(buildViewHand(new THREE.Vector3(0.015, -0.14, 0.04)));
  group.add(buildViewHand(new THREE.Vector3(0, 0.03, -0.38)));
  group.traverse(m => { if (m.isMesh) m.castShadow = true; });
  group.position.set(0.32, -0.32, -0.6);
  return { group, muzzleLocal: new THREE.Vector3(0, 0.015, -0.98) };
}

function buildPistolViewModel() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.3, metalness: 0.75 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.5, metalness: 0.6 });
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.32), mat);
  slide.position.set(0, 0.03, -0.1);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.1, 8), accent);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.3);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), accent);
  grip.position.set(0, -0.08, 0.05);
  group.add(slide, barrel, grip);
  group.add(buildViewHand(new THREE.Vector3(0, -0.08, 0.1)));
  group.traverse(m => { if (m.isMesh) m.castShadow = true; });
  group.position.set(0.28, -0.3, -0.45);
  return { group, muzzleLocal: new THREE.Vector3(0, 0.03, -0.36) };
}

function buildKnifeViewModel() {
  const group = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xcfd6da, roughness: 0.3, metalness: 0.85 });
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x2b2117, roughness: 0.7 });
  const blade = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.32, 4), bladeMat);
  blade.rotation.x = -Math.PI / 2;
  blade.position.set(0, 0, -0.32);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.16, 8), handleMat);
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0, 0, -0.05);
  group.add(blade, handle);
  group.add(buildViewHand(new THREE.Vector3(0, 0, 0.06)));
  group.traverse(m => { if (m.isMesh) m.castShadow = true; });
  group.position.set(0.26, -0.28, -0.42);
  return { group, muzzleLocal: null };
}

function attachMuzzleFX(vm) {
  if (!vm.muzzleLocal) return;
  const light = new THREE.PointLight(0xffb060, 0, 6, 2);
  light.position.copy(vm.muzzleLocal);
  vm.group.add(light);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 });
  const flash = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 8), flashMat);
  flash.rotation.x = -Math.PI / 2;
  flash.position.copy(vm.muzzleLocal);
  vm.group.add(flash);
  vm.muzzleLight = light;
  vm.muzzleFlash = flash;
}

WEAPON_VIEWMODELS.rifle = buildRifleViewModel();
WEAPON_VIEWMODELS.pistol = buildPistolViewModel();
WEAPON_VIEWMODELS.knife = buildKnifeViewModel();
attachMuzzleFX(WEAPON_VIEWMODELS.rifle);
attachMuzzleFX(WEAPON_VIEWMODELS.pistol);
for (const key of Object.keys(WEAPON_VIEWMODELS)) {
  const vm = WEAPON_VIEWMODELS[key];
  vm.basePos = vm.group.position.clone();
  vm.group.visible = false;
  camera.add(vm.group);
}
scene.add(camera);

// ---------------------------------------------------------------------------
// Weapon stats / shooting
// ---------------------------------------------------------------------------
const WEAPONS = {
  knife: { label: 'Combat Knife', kind: 'melee', damage: 48, range: 1.7, fireRate: 0.5, cooldown: 0 },
  pistol: { label: 'Pistol', kind: 'ranged', ammo: 12, magSize: 12, reserve: 48, maxReserve: 48, fireRate: 0.26, damage: 26, reloading: false, reloadTime: 1.0, cooldown: 0, spread: 0.012 },
  rifle: { label: 'Salvaged Rifle', kind: 'ranged', ammo: 30, magSize: 30, reserve: 180, maxReserve: 180, fireRate: 0.11, damage: 18, reloading: false, reloadTime: 1.6, cooldown: 0, spread: 0.018 },
};
let currentWeapon = 'rifle';
function activeWeapon() { return WEAPONS[currentWeapon]; }
function activeViewModel() { return WEAPON_VIEWMODELS[currentWeapon]; }

function switchWeapon(key) {
  if (!WEAPONS[key] || key === currentWeapon || !player.alive) return;
  activeViewModel().group.visible = false;
  currentWeapon = key;
  activeViewModel().group.visible = true;
  player.aiming = false;
  document.getElementById('reload-indicator').style.visibility = 'hidden';
  updateHUD();
}
WEAPON_VIEWMODELS[currentWeapon].group.visible = true;

let footstepTimer = 0;
let mouseDown = false;
let knifeSwing = 0;
document.addEventListener('mousedown', (e) => { if (e.button === 0 && controls.isLocked) mouseDown = true; });
document.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
document.addEventListener('mousedown', (e) => { if (e.button === 2 && controls.isLocked && currentWeapon === 'rifle') player.aiming = true; });
document.addEventListener('mouseup', (e) => { if (e.button === 2) player.aiming = false; });
document.addEventListener('contextmenu', (e) => { if (controls.isLocked) e.preventDefault(); });
window.addEventListener('keydown', (e) => {
  if (e.code === 'Digit1') switchWeapon('knife');
  if (e.code === 'Digit2') switchWeapon('pistol');
  if (e.code === 'Digit3') switchWeapon('rifle');
});

function tryReload() {
  const w = activeWeapon();
  if (w.kind !== 'ranged' || w.reloading || w.ammo === w.magSize || w.reserve <= 0) return;
  w.reloading = true;
  playReloadSound();
  document.getElementById('reload-indicator').style.visibility = 'visible';
  setTimeout(() => {
    const need = w.magSize - w.ammo;
    const take = Math.min(need, w.reserve);
    w.ammo += take;
    w.reserve -= take;
    w.reloading = false;
    document.getElementById('reload-indicator').style.visibility = 'hidden';
    updateHUD();
  }, w.reloadTime * 1000);
}

const tracers = [];
function spawnTracer(from, to, color = 0xfff2c8) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  tracers.push({ line, life: 0.08 });
}

const raycaster = new THREE.Raycaster();
function rangedFire(w) {
  if (w.reloading || w.ammo <= 0 || !player.alive) {
    if (w.ammo <= 0 && !w.reloading) tryReload();
    return;
  }
  markAttack();
  w.ammo--;
  w.cooldown = w.fireRate * (activePowerups.rapidfire ? 0.45 : 1);
  playGunshot(camera.position, currentWeapon === 'pistol' ? 0.6 : 0.8, currentWeapon === 'pistol' ? 1.3 : 1);

  const effectiveSpread = w.spread * (player.aiming && currentWeapon === 'rifle' ? 0.22 : 1);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.x += (Math.random() - 0.5) * effectiveSpread;
  dir.y += (Math.random() - 0.5) * effectiveSpread;
  dir.normalize();

  const origin = new THREE.Vector3();
  camera.getWorldPosition(origin);
  raycaster.set(origin, dir);

  let closest = null, closestDist = Infinity;
  for (const e of hostileTargets()) {
    if (!e.alive) continue;
    const bodyPoint = e.root.position.clone().add(new THREE.Vector3(0, 1.05, 0));
    const dist = raycaster.ray.distanceToPoint(bodyPoint);
    if (dist < 0.85) {
      const d2 = origin.distanceTo(bodyPoint);
      if (d2 < closestDist) { closestDist = d2; closest = e; }
    }
  }

  const vm = activeViewModel();
  const endPoint = origin.clone().add(dir.clone().multiplyScalar(closest ? closestDist : 60));
  if (vm.muzzleFlash) {
    const muzzleWorld = new THREE.Vector3();
    vm.muzzleFlash.getWorldPosition(muzzleWorld);
    spawnTracer(muzzleWorld, endPoint);
    vm.muzzleLight.intensity = 6;
    vm.muzzleFlash.material.opacity = 1;
  }
  vm.group.position.z += 0.05;

  if (closest) {
    const dmg = w.damage * (activePowerups.damage ? 2 : 1);
    damageTarget(closest, dmg);
    flashCrosshairHit();
    playHitTick();
  }
  updateHUD();
}

function meleeAttack(w) {
  if (w.cooldown > 0 || !player.alive) return;
  w.cooldown = w.fireRate;
  markAttack();
  knifeSwing = 1;
  const origin = camera.position.clone();
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  let closest = null, closestDist = Infinity;
  for (const e of hostileTargets()) {
    if (!e.alive) continue;
    const toE = e.root.position.clone().add(new THREE.Vector3(0, 1.05, 0)).sub(origin);
    const dist = toE.length();
    if (dist > w.range) continue;
    const facing = toE.clone().normalize().dot(dir);
    if (facing > 0.55 && dist < closestDist) { closestDist = dist; closest = e; }
  }
  playHitTick();
  if (closest) {
    damageTarget(closest, w.damage);
    flashCrosshairHit();
  }
  updateHUD();
}

// Out-of-combat regeneration: stop attacking for 6.5s and you slowly heal.
const REGEN_DELAY = 6.5, REGEN_RATE = 2.5; // seconds, health per second
let lastAttackAt = -1e9;
function markAttack() { lastAttackAt = performance.now() / 1000; }
function updateRegen(dt) {
  if (player.health <= 0 || player.health >= player.maxHealth) return;
  if (performance.now() / 1000 - lastAttackAt < REGEN_DELAY) return;
  player.health = Math.min(player.maxHealth, player.health + REGEN_RATE * dt);
}

function fireActive() {
  const w = activeWeapon();
  if (w.kind === 'melee') meleeAttack(w);
  else rangedFire(w);
}

// ---------------------------------------------------------------------------
// Grenades — starting loadout of 2; earned back from a kill (capped to roughly
// one every other wave) or topped back up at the ammo station.
// ---------------------------------------------------------------------------
const GRENADE_MAX = 5;
const GRENADE_RADIUS = 5.5;
const GRENADE_DAMAGE = 90;
const GRENADE_FUSE = 1.6;
const grenades = [];
let grenadeAwardedThisWave = false;

function throwGrenade() {
  if (!player.alive || player.grenades <= 0 || !controls.isLocked) return;
  player.grenades--;
  markAttack();
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const origin = camera.position.clone().add(dir.clone().multiplyScalar(0.3));
  const vel = dir.clone().multiplyScalar(15).add(new THREE.Vector3(0, 4.5, 0));
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2a3a28, roughness: 0.6, metalness: 0.4 }));
  mesh.position.copy(origin);
  mesh.castShadow = true;
  scene.add(mesh);
  grenades.push({ mesh, vel, fuse: GRENADE_FUSE });
  playReloadClick(0);
  updateHUD();
}

function explodeGrenade(pos) {
  playExplosion(pos);
  screenShake(0.1);
  const flash = new THREE.PointLight(0xffaa55, 9, GRENADE_RADIUS * 2.2);
  flash.position.copy(pos);
  scene.add(flash);
  let t = 0;
  const fade = () => {
    t += 0.06;
    flash.intensity = 9 * (1 - t);
    if (t < 1) requestAnimationFrame(fade); else scene.remove(flash);
  };
  fade();

  for (const e of hostileTargets()) {
    if (!e.alive) continue;
    const d = e.root.position.distanceTo(pos);
    if (d < GRENADE_RADIUS) damageTarget(e, GRENADE_DAMAGE * (1 - d / GRENADE_RADIUS));
  }
  const playerPos = controls.getObject().position;
  const distToPlayer = playerPos.distanceTo(pos);
  if (distToPlayer < GRENADE_RADIUS) {
    screenShake(0.3);
    if (!player.turned) applyDamageToPlayer(30 * (1 - distToPlayer / GRENADE_RADIUS));
    else applyDamageToZombiePlayer(30 * (1 - distToPlayer / GRENADE_RADIUS));
  }
}

function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.vel.y -= 20 * dt;
    g.mesh.position.addScaledVector(g.vel, dt);
    if (g.mesh.position.y < 0.08) {
      g.mesh.position.y = 0.08;
      g.vel.y *= -0.4;
      g.vel.x *= 0.7; g.vel.z *= 0.7;
    }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      explodeGrenade(g.mesh.position.clone());
      scene.remove(g.mesh);
      grenades.splice(i, 1);
    }
  }
}

function flashCrosshairHit() {
  const ch = document.getElementById('crosshair');
  ch.classList.add('hit');
  setTimeout(() => ch.classList.remove('hit'), 90);
}

// ---------------------------------------------------------------------------
// Audio (procedural SFX synthesized via Web Audio — no external files)
// ---------------------------------------------------------------------------
let audioCtx = null;
let masterGain = null;
function ensureAudio() {
  if (audioCtx) return audioCtx;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.55;
    masterGain.connect(audioCtx.destination);
  } catch (e) { audioCtx = null; }
  return audioCtx;
}

function noiseBuffer(ctx, duration) {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Guards against non-finite input (a corrupted entity position, say) — this
// feeds directly into AudioParam.value, and the Web Audio API throws on a
// non-finite value, which would otherwise abort the render loop mid-frame.
function panFor(worldPos) {
  if (!worldPos || !Number.isFinite(worldPos.x) || !Number.isFinite(worldPos.z)) return 0;
  const toSource = worldPos.clone().sub(camera.position);
  if (toSource.lengthSq() < 0.0001) return 0;
  const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const pan = toSource.normalize().dot(camRight);
  return Number.isFinite(pan) ? THREE.MathUtils.clamp(pan, -1, 1) : 0;
}
function attenFor(worldPos, maxDist = 30) {
  if (!worldPos || !Number.isFinite(worldPos.x) || !Number.isFinite(worldPos.z)) return 0;
  const dist = worldPos.distanceTo(camera.position);
  return Number.isFinite(dist) ? THREE.MathUtils.clamp(1 - dist / maxDist, 0.05, 1) : 0;
}

function playGunshot(worldPos, volume = 1, pitch = 1) {
  const ctx = ensureAudio(); if (!ctx) return;
  const t0 = ctx.currentTime;
  const pan = ctx.createStereoPanner();
  pan.pan.value = panFor(worldPos);
  pan.connect(masterGain);
  const atten = attenFor(worldPos, 40);

  // Short, snappy "bang" — a quick crack with barely any low-end boom behind it.
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.07);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2600 * pitch, t0);
  bp.frequency.exponentialRampToValueAtTime(900 * pitch, t0 + 0.05);
  bp.Q.value = 0.9;
  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(volume * 0.55 * atten, t0);
  crackGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.055);
  src.connect(bp); bp.connect(crackGain); crackGain.connect(pan);
  src.start(t0); src.stop(t0 + 0.07);

  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(150 * pitch, t0);
  thump.frequency.exponentialRampToValueAtTime(70 * pitch, t0 + 0.04);
  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(volume * 0.22 * atten, t0);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.045);
  thump.connect(thumpGain); thumpGain.connect(pan);
  thump.start(t0); thump.stop(t0 + 0.05);
}

function playReloadClick(delay = 0) {
  const ctx = ensureAudio(); if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.25, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);
  osc.connect(g); g.connect(masterGain);
  osc.start(t0); osc.stop(t0 + 0.05);
}
function playReloadSound() { playReloadClick(0); playReloadClick(0.15); }

function playHitTick() {
  const ctx = ensureAudio(); if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 1500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.18, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
  osc.connect(g); g.connect(masterGain);
  osc.start(t0); osc.stop(t0 + 0.06);
}

function playZombieGroan(worldPos, intensity = 1) {
  const ctx = ensureAudio(); if (!ctx) return;
  const atten = attenFor(worldPos, 22);
  if (atten <= 0.06) return;
  const t0 = ctx.currentTime;
  const pan = ctx.createStereoPanner(); pan.pan.value = panFor(worldPos); pan.connect(masterGain);
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const base = 70 + Math.random() * 40;
  osc.frequency.setValueAtTime(base, t0);
  osc.frequency.linearRampToValueAtTime(base * 0.85, t0 + 0.5 * intensity);
  osc.frequency.linearRampToValueAtTime(base * 0.95, t0 + 0.9 * intensity);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.22 * atten, t0 + 0.08);
  g.gain.linearRampToValueAtTime(0, t0 + 0.9 * intensity);
  osc.connect(lp); lp.connect(g); g.connect(pan);
  osc.start(t0); osc.stop(t0 + 0.95 * intensity);
}

// A zombie's voice: a random moan, rasp, screech, or growl — each zombie speaks on its own timer.
function playZombieVoice(worldPos, forcedKind) {
  const ctx = ensureAudio(); if (!ctx) return;
  const atten = attenFor(worldPos, 42);
  if (atten <= 0.06) return;
  const t0 = ctx.currentTime;
  const pan = ctx.createStereoPanner(); pan.pan.value = panFor(worldPos); pan.connect(masterGain);
  const out = ctx.createGain(); out.gain.value = atten; out.connect(pan);
  const kind = forcedKind || ['moan', 'moan', 'rasp', 'screech', 'growl'][Math.floor(Math.random() * 5)];
  const envelope = (g, attack, dur, peak) => {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
  };
  const vibrato = (osc, rate, depth, dur) => {
    const lfo = ctx.createOscillator(); lfo.frequency.value = rate;
    const lg = ctx.createGain(); lg.gain.value = depth;
    lfo.connect(lg); lg.connect(osc.frequency);
    lfo.start(t0); lfo.stop(t0 + dur + 0.05);
  };

  if (kind === 'moan') {
    const dur = 1.4 + Math.random() * 0.7, base = 85 + Math.random() * 50;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base, t0);
    osc.frequency.linearRampToValueAtTime(base * 0.8, t0 + dur);
    vibrato(osc, 5 + Math.random() * 2, 5, dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 4;
    bp.frequency.setValueAtTime(350, t0);
    bp.frequency.linearRampToValueAtTime(720, t0 + dur * 0.5);
    bp.frequency.linearRampToValueAtTime(420, t0 + dur);
    const g = ctx.createGain(); envelope(g, 0.2, dur, 0.55);
    osc.connect(bp); bp.connect(g); g.connect(out);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  } else if (kind === 'rasp') {
    const dur = 0.9;
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1000 + Math.random() * 500; bp.Q.value = 2.5;
    const trem = ctx.createGain(); trem.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 9 + Math.random() * 5;
    const lg = ctx.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg); lg.connect(trem.gain); lfo.start(t0); lfo.stop(t0 + dur);
    const g = ctx.createGain(); envelope(g, 0.12, dur, 0.5);
    src.connect(bp); bp.connect(trem); trem.connect(g); g.connect(out);
    src.start(t0); src.stop(t0 + dur);
  } else if (kind === 'screech') {
    const dur = 0.65;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(380, t0);
    osc.frequency.linearRampToValueAtTime(900, t0 + dur * 0.4);
    osc.frequency.linearRampToValueAtTime(520, t0 + dur);
    vibrato(osc, 28, 40, dur);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 260;
    const g = ctx.createGain(); envelope(g, 0.05, dur, 0.28);
    osc.connect(hp); hp.connect(g); g.connect(out);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  } else {
    const dur = kind === 'snarl' ? 0.45 : 1.0;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 52 + Math.random() * 14;
    if (kind === 'snarl') osc.frequency.linearRampToValueAtTime(110, t0 + dur);
    vibrato(osc, 22, 8, dur);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 5); }
    shaper.curve = curve;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, dur);
    const nlp = ctx.createBiquadFilter(); nlp.type = 'bandpass'; nlp.frequency.value = 700; nlp.Q.value = 1.2;
    const ng = ctx.createGain(); ng.gain.value = 0.35;
    const g = ctx.createGain(); envelope(g, 0.08, dur, 0.5);
    osc.connect(shaper); shaper.connect(lp); lp.connect(g);
    src.connect(nlp); nlp.connect(ng); ng.connect(g);
    g.connect(out);
    osc.start(t0); osc.stop(t0 + dur + 0.05); src.start(t0); src.stop(t0 + dur);
  }
}

function playZombieDeath(worldPos) {
  const ctx = ensureAudio(); if (!ctx) return;
  const t0 = ctx.currentTime;
  const pan = ctx.createStereoPanner(); pan.pan.value = panFor(worldPos); pan.connect(masterGain);
  const atten = attenFor(worldPos, 26);
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(160, t0);
  osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.35);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.3 * atten, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.38);
  osc.connect(g); g.connect(pan);
  osc.start(t0); osc.stop(t0 + 0.4);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.2);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 800;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.15 * atten, t0);
  ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
  src.connect(hp); hp.connect(ng); ng.connect(pan);
  src.start(t0); src.stop(t0 + 0.2);
}

function playExplosion(worldPos) {
  const ctx = ensureAudio(); if (!ctx) return;
  const t0 = ctx.currentTime;
  const pan = ctx.createStereoPanner(); pan.pan.value = panFor(worldPos); pan.connect(masterGain);
  const atten = attenFor(worldPos, 55);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.55);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2200, t0);
  lp.frequency.exponentialRampToValueAtTime(180, t0 + 0.45);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.9 * atten, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
  src.connect(lp); lp.connect(g); g.connect(pan);
  src.start(t0); src.stop(t0 + 0.55);

  const boom = ctx.createOscillator();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(95, t0);
  boom.frequency.exponentialRampToValueAtTime(28, t0 + 0.4);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0.8 * atten, t0);
  bg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);
  boom.connect(bg); bg.connect(pan);
  boom.start(t0); boom.stop(t0 + 0.45);
}

function playPlayerHurt() {
  const ctx = ensureAudio(); if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(140, t0);
  osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.3, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
  osc.connect(g); g.connect(masterGain);
  osc.start(t0); osc.stop(t0 + 0.3);
}

function playPickup() {
  const ctx = ensureAudio(); if (!ctx) return;
  const t0 = ctx.currentTime;
  [660, 990].forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = ctx.createGain();
    const start = t0 + i * 0.07;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.22, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
    osc.connect(g); g.connect(masterGain);
    osc.start(start); osc.stop(start + 0.24);
  });
}

function playWaveStart() {
  const ctx = ensureAudio(); if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(60, t0);
  osc.frequency.linearRampToValueAtTime(110, t0 + 1.1);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.28, t0 + 0.2);
  g.gain.linearRampToValueAtTime(0, t0 + 1.2);
  osc.connect(lp); lp.connect(g); g.connect(masterGain);
  osc.start(t0); osc.stop(t0 + 1.25);
}

function playWaveClear() {
  const ctx = ensureAudio(); if (!ctx) return;
  const t0 = ctx.currentTime;
  [523, 659, 784].forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = ctx.createGain();
    const start = t0 + i * 0.1;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.2, start + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
    osc.connect(g); g.connect(masterGain);
    osc.start(start); osc.stop(start + 0.42);
  });
}

function playFootstep() {
  const ctx = ensureAudio(); if (!ctx) return;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.08);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300 + Math.random() * 80;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.1, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
  src.connect(lp); lp.connect(g); g.connect(masterGain);
  src.start(t0); src.stop(t0 + 0.09);
}

let heartbeatTimer = null;
function startHeartbeat() {
  if (heartbeatTimer) return;
  const beat = () => {
    const ctx = ensureAudio(); if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(60, t0);
    osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    osc.connect(g); g.connect(masterGain);
    osc.start(t0); osc.stop(t0 + 0.2);
  };
  beat();
  heartbeatTimer = setInterval(beat, 750);
}
function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

// ---------------------------------------------------------------------------
// Characters (shared builder for enemies & allies)
// ---------------------------------------------------------------------------
const sharedShoeMat = new THREE.MeshStandardMaterial({ color: 0x1c1813, roughness: 0.85 });
// Tapered (shoulders->waist, thigh->ankle, etc.) rather than uniform capsules —
// a real body narrows along its limbs; uniform cylinders read as toy-avatar blocky.
const sharedTorsoGeo = new THREE.CylinderGeometry(0.17, 0.135, 0.52, 10);
const sharedNeckGeo = new THREE.CylinderGeometry(0.058, 0.075, 0.1, 8);
const sharedHipsGeo = new THREE.CylinderGeometry(0.145, 0.165, 0.18, 10);
const sharedHeadGeo = new THREE.SphereGeometry(0.175, 16, 14);
const sharedFaceGeo = new THREE.PlaneGeometry(0.23, 0.23);
const sharedHandGeo = new THREE.SphereGeometry(0.06, 8, 6);
const sharedShoeGeo = new THREE.BoxGeometry(0.14, 0.085, 0.22);
const sharedArmGeo = new THREE.CylinderGeometry(0.05, 0.038, 0.42, 8);
const sharedLegGeo = new THREE.CylinderGeometry(0.1, 0.075, 0.48, 8);

function makeFaceTexture(isZombie, skinCss) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = skinCss;
  ctx.fillRect(0, 0, 64, 64);

  const eyeY = isZombie ? 27 : 24;
  ctx.fillStyle = isZombie ? '#d8e29a' : '#fdfdf5';
  ctx.beginPath(); ctx.ellipse(21, eyeY, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(43, eyeY, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = isZombie ? '#7a8a2a' : '#2a1f18';
  ctx.beginPath(); ctx.arc(21, eyeY, isZombie ? 4.3 : 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(43, eyeY, isZombie ? 4.3 : 3, 0, Math.PI * 2); ctx.fill();

  if (isZombie) {
    ctx.strokeStyle = 'rgba(20,10,10,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(21, eyeY, 9, 7, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(43, eyeY, 9, 7, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#3a0a0a';
    ctx.beginPath(); ctx.ellipse(32, 46, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8e2c8';
    for (let i = -2; i <= 2; i++) ctx.fillRect(32 + i * 3.4 - 1, 42, 2, 4);
    ctx.fillStyle = 'rgba(100,10,10,0.75)';
    ctx.fillRect(30, 50, 3, 11);
    ctx.fillStyle = 'rgba(70,90,20,0.35)';
    ctx.beginPath(); ctx.ellipse(14, 36, 5, 3, 0.4, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.strokeStyle = 'rgba(40,25,15,0.8)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(14, 16); ctx.lineTo(28, 14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(36, 14); ctx.lineTo(50, 16); ctx.stroke();
    ctx.strokeStyle = '#7a3a35';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(23, 46); ctx.quadraticCurveTo(32, 50, 41, 46); ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}

function buildPrimitiveCharacter(kind) {
  const isZombie = kind === 'zombie';
  const g = new THREE.Group();

  const skinTone = isZombie
    ? new THREE.Color().setHSL(0.26 + Math.random() * 0.05, 0.3 + Math.random() * 0.1, 0.26 + Math.random() * 0.08)
    : new THREE.Color().setHSL(0.07 + Math.random() * 0.05, 0.4 + Math.random() * 0.15, 0.4 + Math.random() * 0.2);
  const clothColor = isZombie
    ? new THREE.Color().setHSL(0.08 + Math.random() * 0.06, 0.2, 0.14 + Math.random() * 0.06)
    : new THREE.Color().setHSL(Math.random(), 0.4, 0.3 + Math.random() * 0.15);

  const faceTex = makeFaceTexture(isZombie, '#' + skinTone.getHexString());
  const skinMat = new THREE.MeshStandardMaterial({ color: skinTone, roughness: 0.78, metalness: 0.02 });
  const clothMat = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.75, metalness: 0.04 });
  const faceMat = new THREE.MeshStandardMaterial({
    map: faceTex, emissiveMap: faceTex, emissive: 0xffffff,
    emissiveIntensity: isZombie ? 0.4 : 0.05, roughness: 0.7,
  });

  const torso = new THREE.Mesh(sharedTorsoGeo, clothMat);
  torso.position.y = 1.05;
  const hips = new THREE.Mesh(sharedHipsGeo, clothMat);
  hips.position.y = 0.66;
  const head = new THREE.Mesh(sharedHeadGeo, skinMat);
  head.position.y = 1.56;
  const face = new THREE.Mesh(sharedFaceGeo, faceMat);
  face.position.set(0, 1.56, 0.19);

  g.add(torso, hips, head, face);

  if (!isZombie) {
    const gearMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.25 + Math.random() * 0.08, 0.18, 0.2), roughness: 0.85 });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), gearMat);
    helmet.position.y = 1.5;
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.27), gearMat);
    vest.position.set(0, 1.05, 0);
    const pouchGeo = new THREE.BoxGeometry(0.09, 0.1, 0.05);
    for (const x of [-0.1, 0, 0.1]) { const pouch = new THREE.Mesh(pouchGeo, sharedShoeMat); pouch.position.set(x, 0.97, 0.15); g.add(pouch); }
    g.add(helmet, vest);
  }
  if (isZombie && Math.random() < 0.6) {
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x1a1812, roughness: 0.95 });
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 6, Math.random() * Math.PI, 1.2, 0, Math.PI * 0.4), hairMat);
    hair.position.y = 1.6;
    g.add(hair);
  }

  const shoulderY = 1.32, hipY = 0.6;
  const armLen = 0.42, armR0 = 0.065;
  const legLen = 0.48, legR0 = 0.09;

  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.33, shoulderY, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(armR0, armLen, 3, 6), clothMat);
    mesh.position.y = -(armLen / 2 + armR0);
    const hand = new THREE.Mesh(sharedHandGeo, skinMat);
    hand.position.y = -(armLen + armR0 * 2);
    pivot.add(mesh, hand);
    return pivot;
  }
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.14, hipY, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(legR0, legLen, 3, 6), clothMat);
    mesh.position.y = -(legLen / 2 + legR0);
    const shoe = new THREE.Mesh(sharedShoeGeo, sharedShoeMat);
    shoe.position.set(0, -(legLen + legR0 * 2) + 0.02, 0.04);
    pivot.add(mesh, shoe);
    return pivot;
  }

  const armL = makeArm(-1), armR = makeArm(1);
  const legL = makeLeg(-1), legR = makeLeg(1);
  g.add(armL, armR, legL, legR);

  g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  g.userData.parts = { torso, armL, armR, legL, legR, head };
  return g;
}

// ---------------------------------------------------------------------------
// Real human models (rigged + textured Mixamo characters). Falls back to the
// primitive builder if the .glb files fail to load.
// ---------------------------------------------------------------------------
const humanModels = {};
const charMixers = [];
const gltfLoader = new GLTFLoader();

function prepModel(scene) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const scale = 1.78 / (box.max.y - box.min.y);
  return { scene, scale, minY: box.min.y };
}
// Pale, rotted, blood-soaked skin variants painted over the original texture
// (desaturated, grimy, with wounds and streaks) so zombies read as the dead,
// not as the survivors with a green tint.
function buildZombieSkins() {
  const size = 1024, skins = [];
  const skinBase = ['#a2a79b', '#aaa49a', '#98a3a3', '#a9aa97'];
  const cloth = [['#4a4f57', '#6a5c4c', '#3b3f3a'], ['#5b4a44', '#40464f', '#6d6a5c'], ['#38424d', '#58503f', '#4d4d4d'], ['#4b3f3a', '#5a5f66', '#363c36']];
  for (let v = 0; v < 4; v++) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = skinBase[v]; g.fillRect(0, 0, size, size);
    const blotch = (n, rgba0, minR, maxR) => {
      for (let i = 0; i < n; i++) {
        const x = Math.random() * size, y = Math.random() * size, r = minR + Math.random() * (maxR - minR);
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, rgba0); grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    };
    blotch(120, 'rgba(60,50,60,0.30)', 10, 60);
    blotch(60, 'rgba(210,214,200,0.22)', 10, 50);
    // dark veins under the skin
    g.strokeStyle = 'rgba(70,40,70,0.45)';
    for (let i = 0; i < 80; i++) {
      let x = Math.random() * size, y = Math.random() * size;
      g.lineWidth = 1 + Math.random() * 1.5; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.3) * 40; g.lineTo(x, y); }
      g.stroke();
    }
    // torn, filthy clothing: jagged patches that leave skin and wounds showing through
    for (let i = 0; i < 22; i++) {
      const cx = Math.random() * size, cy = Math.random() * size, rad = 50 + Math.random() * 150;
      const pts = 9 + Math.floor(Math.random() * 6);
      g.beginPath();
      for (let k = 0; k < pts; k++) {
        const ang = (k / pts) * Math.PI * 2, rr = rad * (0.55 + Math.random() * 0.6);
        const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr * (0.7 + Math.random() * 0.6);
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath();
      g.fillStyle = cloth[v][Math.floor(Math.random() * 3)]; g.fill();
      g.strokeStyle = 'rgba(15,12,10,0.7)'; g.lineWidth = 3; g.stroke();
      for (let t = 0; t < 14; t++) {          // weave / wear
        g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1;
        const wx = cx + (Math.random() - 0.5) * rad, wy = cy + (Math.random() - 0.5) * rad;
        g.beginPath(); g.moveTo(wx, wy); g.lineTo(wx + (Math.random() - 0.5) * 30, wy + 10 + Math.random() * 30); g.stroke();
      }
    }
    // open wounds + blood
    blotch(35, 'rgba(110,8,8,0.85)', 8, 28);
    blotch(70, 'rgba(60,5,5,0.6)', 10, 50);
    g.strokeStyle = 'rgba(80,8,8,0.6)';
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      g.lineWidth = 1 + Math.random() * 3; g.beginPath(); g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 12, y + 20 + Math.random() * 90); g.stroke();
    }
    g.fillStyle = 'rgba(20,18,14,0.2)'; g.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    skins.push(tex);
  }
  return skins;
}

async function loadHumanModels() {
  try {
    const soldier = await gltfLoader.loadAsync('./models/Soldier.glb');
    humanModels.zombieSkins = buildZombieSkins();
    humanModels.male = {
      ...prepModel(soldier.scene),
      idle: THREE.AnimationClip.findByName(soldier.animations, 'Idle'),
      walk: THREE.AnimationClip.findByName(soldier.animations, 'Walk'),
    };
  } catch (err) {
    console.warn('Human model failed to load; using primitive characters.', err);
  }
}

// Hanging rag strips for torn clothing. Bones are in centimetres (the model
// root is scaled 0.01), so sizes here are cm.
const ragMats = ['#4a4f57', '#6a5c4c', '#3b3f3a', '#5b4a44'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1, side: THREE.DoubleSide }));
function addRags(bone, count, radius, maxLen, flare) {
  if (!bone) return;
  for (let i = 0; i < count; i++) {
    const len = maxLen * (0.45 + Math.random() * 0.55), w = 4 + Math.random() * 6;
    const geo = new THREE.PlaneGeometry(w, len, 1, 3);
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) {            // ragged, uneven bottom edge
      if (pos.getY(k) < 0) pos.setX(k, pos.getX(k) + (Math.random() - 0.5) * w * 0.7);
    }
    geo.translate(0, -len / 2, 0);
    const rag = new THREE.Mesh(geo, ragMats[Math.floor(Math.random() * ragMats.length)]);
    const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    rag.position.set(Math.cos(ang) * radius, -2 - Math.random() * 4, Math.sin(ang) * radius);
    rag.rotation.y = -ang + Math.PI / 2;
    rag.rotation.x = flare + (Math.random() - 0.5) * 0.3;
    rag.userData.rag = { baseX: rag.rotation.x, phase: Math.random() * 10 };
    rag.castShadow = true;
    bone.add(rag);
  }
}

// Rifle carried by survivors, parented to the right-hand bone so it follows the animation.
function buildAllyGun() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.55, metalness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.8, metalness: 0.05 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.frustumCulled = false; g.add(m); return m; };
  // built along +Z (barrel forward), ~0.95m long, grip near the origin
  add(new THREE.BoxGeometry(0.06, 0.1, 0.42), dark, 0, 0.02, 0.18);           // receiver
  add(new THREE.CylinderGeometry(0.014, 0.014, 0.34, 8), dark, 0, 0.04, 0.55).rotation.x = Math.PI / 2; // barrel
  add(new THREE.BoxGeometry(0.05, 0.07, 0.24), wood, 0, 0.01, -0.16);          // stock
  add(new THREE.BoxGeometry(0.04, 0.14, 0.06), dark, 0, -0.09, 0.14);          // magazine
  add(new THREE.BoxGeometry(0.035, 0.1, 0.045), wood, 0, -0.07, 0.0);          // grip
  return g;
}

function buildHuman(kind) {
  const isZombie = kind === 'zombie';
  const src = humanModels.male;
  const g = new THREE.Group();
  const model = cloneSkinned(src.scene);
  const s = src.scale * (0.95 + Math.random() * 0.1);
  const inner = new THREE.Group();
  model.rotation.y = Math.PI; // the Mixamo soldier faces -Z; characters here face +Z
  inner.add(model);
  inner.scale.setScalar(s);
  inner.position.y = -src.minY * s;
  if (isZombie) inner.rotation.x = 0.12;
  g.add(inner);

  model.traverse(m => {
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    m.material = m.material.clone();
    if (!isZombie) {
      const v = 0.75 + Math.random() * 0.35;
      m.material.color.setRGB(v * (0.9 + Math.random() * 0.2), v, v * (0.85 + Math.random() * 0.3));
    }
    if (isZombie) {
      if (m.name === 'vanguard_visor') { m.visible = false; return; }
      const skins = humanModels.zombieSkins;
      if (skins && skins.length) m.material.map = skins[Math.floor(Math.random() * skins.length)];
      m.material.color.setRGB(1, 1, 1);
      m.material.roughness = 0.95;
      m.material.metalness = 0;
    }
  });

  if (!isZombie) {
    const hand = model.getObjectByName('mixamorigRightHand');
    if (hand) {
      const gun = buildAllyGun();
      hand.add(gun);
      hand.updateWorldMatrix(true, false);
      gun.scale.setScalar(1 / hand.getWorldScale(new THREE.Vector3()).x); // bones live in cm
      gun.position.set(0, 8, 2);
      gun.quaternion.set(0.1267, -0.2710, -0.9497, 0.0925); // barrel forward, held at the hip (tuned for the Mixamo hand bone)
    }
  }

  const mixer = new THREE.AnimationMixer(model);
  const idleAct = mixer.clipAction(src.idle);
  const walkAct = mixer.clipAction(src.walk);
  if (isZombie) { walkAct.timeScale = 1.1; idleAct.timeScale = 0.6; }
  idleAct.play();
  mixer.update(Math.random() * 2);
  const entry = { group: g, mixer, idleAct, walkAct, walking: false, moveFlag: false, lastT: NaN, isZombie, phase: Math.random() * 100 };
  if (isZombie) {
    // Each zombie gets its own wrong-looking posture: head cocked, spine hunched, one arm hanging.
    const bone = n => model.getObjectByName(n);
    const rnd = (a, b) => a + Math.random() * (b - a);
    entry.twist = [
      [bone('mixamorigSpine1'), new THREE.Euler(rnd(0.3, 0.55), rnd(-0.3, 0.3), rnd(-0.25, 0.25))],
      [bone('mixamorigNeck'), new THREE.Euler(rnd(0.1, 0.35), rnd(-0.3, 0.3), rnd(-0.6, 0.6))],
      [bone('mixamorigLeftArm'), new THREE.Euler(rnd(-0.2, 0.6), 0, rnd(-0.5, 0.5))],
      [bone('mixamorigRightArm'), new THREE.Euler(rnd(-1.1, 0.2), 0, rnd(-0.5, 0.5))],
      [bone('mixamorigRightForeArm'), new THREE.Euler(rnd(0, 0.9), 0, 0)],
    ].filter(([b]) => b).map(([b, e]) => [b, new THREE.Quaternion().setFromEuler(e)]);
    entry.head = bone('mixamorigHead');
    addRags(bone('mixamorigHips'), 7, 14, 34, 0);
    addRags(bone('mixamorigSpine1'), 5, 16, 24, 0.25);
    entry.rags = [];
    model.traverse(o => { if (o.userData.rag) entry.rags.push(o); });
  }
  g.userData.human = entry;
  charMixers.push(entry);
  return g;
}

function buildCharacter(kind) {
  return humanModels.male ? buildHuman(kind) : buildPrimitiveCharacter(kind);
}

function updateCharacterMixers(dt) {
  for (let i = charMixers.length - 1; i >= 0; i--) {
    const e = charMixers[i];
    if (!e.group.parent) { charMixers.splice(i, 1); continue; }
    if (e.moveFlag !== e.walking) {
      e.walking = e.moveFlag;
      const [on, off] = e.walking ? [e.walkAct, e.idleAct] : [e.idleAct, e.walkAct];
      on.reset().fadeIn(0.2).play();
      off.fadeOut(0.2);
    }
    e.moveFlag = false;
    if (e.isZombie) {
      // Lurching, uneven gait: the animation speeds up and stalls in bursts.
      const k = (performance.now() / 1000) * 3.1 + e.phase;
      e.walkAct.timeScale = 0.55 + 1.35 * Math.abs(Math.sin(k)) * (0.6 + 0.4 * Math.sin(k * 2.3));
    }
    e.mixer.update(dt);
    if (e.rags) {
      const now = performance.now() / 1000;
      for (const r of e.rags) r.rotation.x = r.userData.rag.baseX + Math.sin(now * 4 + r.userData.rag.phase) * (e.walking ? 0.45 : 0.12);
    }
    if (e.twist) {
      for (const [b, q] of e.twist) b.quaternion.multiply(q);
      if (e.head && Math.sin(performance.now() / 180 + e.phase * 3) > 0.93) {
        e.head.rotation.z += 0.35 * Math.sin(performance.now() / 40 + e.phase);
      }
    }
  }
}

function animateWalk(group, t, speedMul = 1) {
  const h = group.userData.human;
  if (h) {
    if (speedMul >= 0.5 && t !== h.lastT) h.moveFlag = true;
    h.lastT = t;
    return;
  }
  const p = group.userData.parts;
  const s = Math.sin(t * 9 * speedMul) * 0.5 * speedMul;
  p.armL.rotation.x = s;
  p.armR.rotation.x = -s;
  p.legL.rotation.x = -s;
  p.legR.rotation.x = s;
  p.torso.position.y = 1.05 + Math.abs(Math.sin(t * 9 * speedMul)) * 0.02 * speedMul;
}

// ---------------------------------------------------------------------------
// Health bars (billboard sprites via canvas)
// ---------------------------------------------------------------------------
function makeHealthBarSprite() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 10;
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.9, 0.14, 1);
  sprite.renderOrder = 10;
  sprite.userData.draw = (pct, color) => {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 64, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, 64, 10);
    ctx.fillStyle = color;
    ctx.fillRect(2, 2, 60 * Math.max(0, pct), 6);
    tex.needsUpdate = true;
  };
  sprite.userData.draw(1, '#ff4d4d');
  return sprite;
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------
const enemies = [];
let wave = 1;
let enemiesRemainingToSpawn = 0;
let waveActive = false;
let currentSpawnInterval = null;
const HUMAN_WIN_WAVE = 30;

function spawnEnemy(hpMul, speedMul) {
  const root = buildCharacter('zombie');
  const ang = randomYardAngle();
  const r = ARENA_RADIUS - 2;
  root.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
  scene.add(root);

  const bar = makeHealthBarSprite();
  bar.position.set(0, 2.0, 0);
  root.add(bar);

  const maxHealth = 130 * hpMul;
  const enemy = {
    root, bar, maxHealth, health: maxHealth,
    speed: (1.5 + Math.random() * 0.5) * speedMul,
    alive: true, attackCooldown: 0,
    walkT: Math.random() * 10,
  };
  enemies.push(enemy);
}

function damageEnemy(enemy, amount) {
  if (!enemy.alive) return;
  enemy.health -= amount;
  enemy.bar.userData.draw(Math.max(0, enemy.health / enemy.maxHealth), '#ff4d4d');
  if (enemy.health <= 0) killEnemy(enemy);
}

function killEnemy(enemy) {
  enemy.alive = false;
  playZombieDeath(enemy.root.position);
  scene.remove(enemy.root);
  player.score += 100;
  addKillFeed('You put down a zombie', '#b4ff6e');
  maybeDropPowerup(enemy.root.position);
  if (wave % 2 === 0 && !grenadeAwardedThisWave && player.grenades < GRENADE_MAX) {
    grenadeAwardedThisWave = true;
    player.grenades++;
    addKillFeed('Found a grenade on the body', '#ffd23c');
  }
  updateHUD();
  checkWaveCleared();
}

function startWave(n) {
  wave = n;
  waveActive = true;
  grenadeAwardedThisWave = false;
  const count = waveCount(n);
  enemiesRemainingToSpawn = count;
  const hpMul = (1 + (n - 1) * 0.18) * difficulty.hp;
  const speedMul = (1 + (n - 1) * 0.05) * difficulty.speed;

  showBanner(`WAVE ${n}`, `${count} ZOMBIES INCOMING`);
  playWaveStart();
  relocateAmmoStation();
  if (n > 1) addKillFeed('The supply crate has moved', '#bcd9ff');

  let spawned = 0;
  currentSpawnInterval = setInterval(() => {
    if (spawned >= count || !player.alive) { clearInterval(currentSpawnInterval); return; }
    spawnEnemy(hpMul, speedMul);
    spawned++;
  }, 450);
  updateHUD();
}

function checkWaveCleared() {
  const aliveCount = enemies.filter(e => e.alive).length;
  updateHUD();
  if (aliveCount === 0 && waveActive && enemiesRemainingToSpawn <= waveCount(wave)) {
    const stillSpawning = enemies.length < waveCount(wave);
    if (!stillSpawning) {
      waveActive = false;
      player.score += 250;
      if (wave >= HUMAN_WIN_WAVE) {
        triggerHumanWin();
        return;
      }
      showBanner(`WAVE ${wave} CLEAR`, 'The horde thins… for now');
      playWaveClear();
      setTimeout(() => { if (player.alive && !player.turned) startWave(wave + 1); }, 3200);
    }
  }
}

// ---------------------------------------------------------------------------
// Allies
// ---------------------------------------------------------------------------
const allies = [];
function spawnAlly(offsetAngle) {
  const root = buildCharacter('survivor');
  root.position.copy(controls.getObject().position);
  root.position.y = 0;
  scene.add(root);

  const bar = makeHealthBarSprite();
  bar.position.set(0, 2.0, 0);
  bar.userData.draw(1, '#4df0ff');
  root.add(bar);

  const ally = {
    root, bar, maxHealth: 120, health: 120, alive: true,
    offsetAngle, fireCooldown: 0, walkT: Math.random() * 10,
    target: null,
  };
  allies.push(ally);
  renderAllyHUD();
  return ally;
}

function renderAllyHUD() {
  const box = document.getElementById('hud-top-left');
  box.innerHTML = '';
  allies.forEach((a) => {
    const chip = document.createElement('div');
    chip.className = 'ally-chip';
    chip.innerHTML = `<div class="ally-dot"></div><div class="ally-hp-track"><div class="ally-hp-fill" style="width:${(a.health / a.maxHealth) * 100}%"></div></div>`;
    box.appendChild(chip);
  });
}

function updateAllyAI(ally, dt, t) {
  if (!ally.alive) return;
  recoverIfCorrupted(ally.root.position, controls.getObject().position);
  if (player.turned) {
    const dist = allyEngagePlayer(ally, dt, { turnSpeed: 0.12, range: 16, muzzleY: 1.4, cooldownMin: 0.8, cooldownJitter: 0.5, dmgMin: 6, dmgJitter: 5, vol: 0.45, pitch: 1.5 });
    const desired = new THREE.Vector3();
    if (dist < 4.5) {
      const away = ally.root.position.clone().sub(controls.getObject().position);
      away.y = 0;
      if (away.lengthSq() > 0.001) desired.copy(away.normalize()).multiplyScalar(1.6 * dt);
    }
    ally.root.position.add(desired);
    collideObstacles(ally.root.position, 0.5);
    collideHouseWalls(ally.root.position, 0.5);
    ally.walkT += dt * (desired.length() > 0.001 ? 1 : 0.0);
    animateWalk(ally.root, ally.walkT, 1);
    ally.bar.lookAt(camera.position);
    return;
  }
  // find nearest living enemy
  let nearest = null, nearestDist = Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = ally.root.position.distanceTo(e.root.position);
    if (d < nearestDist) { nearestDist = d; nearest = e; }
  }

  const desired = new THREE.Vector3();
  if (nearest && nearestDist < 20) {
    ally.target = nearest;
    const facing = nearest.root.position.clone().sub(ally.root.position);
    if (nearestDist > 6) {
      facing.normalize();
      desired.copy(facing).multiplyScalar(2.2 * dt);
    }
    const lookAngle = Math.atan2(facing.x, facing.z);
    ally.root.rotation.y = THREE.MathUtils.lerp(ally.root.rotation.y, lookAngle, 0.15);

    ally.fireCooldown -= dt;
    if (ally.fireCooldown <= 0 && nearestDist < 18) {
      ally.fireCooldown = 0.9 + Math.random() * 0.4;
      const from = ally.root.position.clone().add(new THREE.Vector3(0, 1.4, 0));
      const to = nearest.root.position.clone().add(new THREE.Vector3(0, 1.1, 0));
      spawnTracer(from, to, 0x7cf4ff);
      playGunshot(from, 0.45, 1.5);
      damageEnemy(nearest, 10 + Math.random() * 6);
    }
  } else {
    // follow player at formation offset
    const playerPos = controls.getObject().position;
    const off = new THREE.Vector3(Math.cos(ally.offsetAngle), 0, Math.sin(ally.offsetAngle)).multiplyScalar(2.6);
    const targetPos = playerPos.clone().add(off);
    targetPos.y = 0;
    const toTarget = targetPos.clone().sub(ally.root.position);
    toTarget.y = 0;
    const dist = toTarget.length();
    if (dist > 0.6) {
      toTarget.normalize();
      desired.copy(toTarget).multiplyScalar(Math.min(dist, 3.4) * dt);
      const lookAngle = Math.atan2(toTarget.x, toTarget.z);
      ally.root.rotation.y = THREE.MathUtils.lerp(ally.root.rotation.y, lookAngle, 0.08);
    }
  }

  ally.root.position.add(desired);
  collideObstacles(ally.root.position, 0.5);
  collideHouseWalls(ally.root.position, 0.5);
  ally.walkT += dt * (desired.length() > 0.001 ? 1 : 0.0);
  animateWalk(ally.root, ally.walkT, 1);
  ally.bar.lookAt(camera.position);
}

// ---------------------------------------------------------------------------
// Enemy AI
// ---------------------------------------------------------------------------
// True once any opening is passable — either smashed in by zombies ('broken')
// or left unlocked/pried open by the player ('open'). Either way the horde
// can just walk in, so there's no more point besieging a boarded one.
function anyOpeningPassable() {
  return HOUSE_OPENINGS.some(o => o.state !== 'boarded');
}
function nearestBoardedOpening(fromPos) {
  let best = null, bestDist = Infinity;
  for (const o of HOUSE_OPENINGS) {
    if (o.state !== 'boarded') continue;
    const d = fromPos.distanceTo(o.worldCenter);
    if (d < bestDist) { bestDist = d; best = o; }
  }
  return best;
}

function updateEnemyAI(enemy, dt) {
  if (!enemy.alive) return;
  if (recoverIfCorrupted(enemy.root.position, new THREE.Vector3(ARENA_RADIUS - 2, 0, 0))) return;
  enemy.voiceT = (enemy.voiceT ?? 0.5 + Math.random() * 4) - dt;
  if (enemy.voiceT <= 0) { enemy.voiceT = 3 + Math.random() * 5; playZombieVoice(enemy.root.position); }
  const playerPos = controls.getObject().position;

  // Until a way in exists, zombies besiege the nearest boarded opening instead
  // of walking at the player (who they can't physically reach yet).
  const target = anyOpeningPassable() ? null : nearestBoardedOpening(enemy.root.position);
  const targetPos = target ? target.worldCenter : playerPos;

  const toTarget = targetPos.clone().sub(enemy.root.position);
  toTarget.y = 0;
  const dist = toTarget.length();
  const meleeRange = target ? 1.5 : 1.6;

  if (dist > meleeRange) {
    toTarget.normalize();
    const move = toTarget.multiplyScalar(enemy.speed * dt);
    enemy.root.position.add(move);
    collideObstacles(enemy.root.position, 0.5);
    collideHouseWalls(enemy.root.position, 0.5);
    const lookAngle = Math.atan2(toTarget.x, toTarget.z);
    enemy.root.rotation.y = THREE.MathUtils.lerp(enemy.root.rotation.y, lookAngle, 0.15);
    enemy.walkT += dt;
    animateWalk(enemy.root, enemy.walkT, 1.2);
  } else {
    enemy.attackCooldown -= dt;
    if (enemy.attackCooldown <= 0) {
      enemy.attackCooldown = 0.9;
      playZombieVoice(enemy.root.position, 'snarl');
      if (target) {
        damageOpening(target, (8 + Math.random() * 5) * difficulty.dmg);
      } else {
        applyDamageToPlayer(7 + Math.random() * 4);
        screenShake(0.18);
      }
    }
  }
  enemy.bar.lookAt(camera.position);
}

// ---------------------------------------------------------------------------
// Power-ups
// ---------------------------------------------------------------------------
const POWERUP_TYPES = [
  { key: 'health', label: 'Medkit', icon: '➕', color: 0xff5a5a, duration: 0 },
  { key: 'speed', label: 'Adrenaline Shot', icon: '⚡', color: 0x4dd0ff, duration: 10 },
  { key: 'damage', label: 'Incendiary Rounds', icon: '🔥', color: 0xffa13c, duration: 10 },
  { key: 'rapidfire', label: 'Full Auto', icon: '🔫', color: 0xffe14d, duration: 9 },
  { key: 'shield', label: 'Riot Shield', icon: '🛡', color: 0x4df0c0, duration: 12 },
  { key: 'ally', label: 'Flare: Call Survivor', icon: '👥', color: 0x7cff8a, duration: 0 },
  { key: 'housekey', label: 'House Key', icon: '🔑', color: 0xffe066, duration: 0 },
];

const powerups = [];
const activePowerups = {}; // key -> remaining seconds

function maybeDropPowerup(position) {
  if (Math.random() > 0.32) return;
  const pool = POWERUP_TYPES.filter(t => t.key !== 'housekey' && (t.key !== 'ally' || allies.length < 4));
  const type = pool[Math.floor(Math.random() * pool.length)];
  dropPowerup(position, type);
}

function dropPowerup(position, type) {
  const geo = new THREE.OctahedronGeometry(0.4, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: type.color, emissive: type.color, emissiveIntensity: 0.9,
    roughness: 0.25, metalness: 0.3,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  mesh.position.y = 0.9;
  mesh.castShadow = true;
  const light = new THREE.PointLight(type.color, 1.5, 4);
  mesh.add(light);
  scene.add(mesh);
  powerups.push({ mesh, type, t: Math.random() * 10, life: type.key === 'housekey' ? Infinity : 20 });
}

function spawnRandomFieldPowerup() {
  const ang = randomYardAngle();
  const r = 6 + Math.random() * (ARENA_RADIUS - 12);
  const pool = POWERUP_TYPES.filter(t => t.key !== 'ally' && t.key !== 'housekey');
  const type = pool[Math.floor(Math.random() * pool.length)];
  dropPowerup(new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r), type);
}
setInterval(() => { if (player.alive && gameStarted) spawnRandomFieldPowerup(); }, 14000);

function spawnHouseKey() {
  const ang = randomYardAngle();
  const r = 10 + Math.random() * (ARENA_RADIUS - 16);
  dropPowerup(new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r), POWERUP_TYPES.find(t => t.key === 'housekey'));
}

function applyPowerup(type) {
  playPickup();
  addKillFeed(`${type.icon} ${type.label} acquired`, '#ffe9a8');
  switch (type.key) {
    case 'health':
      player.health = Math.min(player.maxHealth, player.health + 35);
      break;
    case 'ally':
      if (allies.length < 4) spawnAlly((allies.length / 4) * Math.PI * 2);
      break;
    case 'housekey':
      player.hasKey = true;
      break;
    default:
      activePowerups[type.key] = type.duration;
      if (type.key === 'shield') player.shield = player.maxShield;
      break;
  }
  updateHUD();
  renderPowerupTray();
}

function updatePowerups(dt, t) {
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.t += dt;
    p.mesh.rotation.y += dt * 1.4;
    p.mesh.position.y = 0.9 + Math.sin(p.t * 2) * 0.12;
    p.life -= dt;
    const d = distXZ(p.mesh.position, controls.getObject().position);
    if (d < 1.1) {
      applyPowerup(p.type);
      scene.remove(p.mesh);
      powerups.splice(i, 1);
      continue;
    }
    if (p.life <= 0) {
      scene.remove(p.mesh);
      powerups.splice(i, 1);
    }
  }

  for (const key of Object.keys(activePowerups)) {
    activePowerups[key] -= dt;
    if (activePowerups[key] <= 0) delete activePowerups[key];
  }
}

function renderPowerupTray() {
  const tray = document.getElementById('powerup-tray');
  tray.innerHTML = '';
  for (const key of Object.keys(activePowerups)) {
    const type = POWERUP_TYPES.find(t => t.key === key);
    const el = document.createElement('div');
    el.className = 'pu-icon';
    el.innerHTML = `${type.icon}<div class="pu-timer" style="width:100%"></div>`;
    el.dataset.key = key;
    el.dataset.duration = type.duration;
    tray.appendChild(el);
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function updateHUD() {
  document.getElementById('health-fill').style.width = `${Math.max(0, (player.health / player.maxHealth) * 100)}%`;
  document.getElementById('shield-fill').style.width = `${Math.max(0, (player.shield / player.maxShield) * 100)}%`;
  document.getElementById('stamina-fill').style.width = `${Math.max(0, (player.stamina / player.maxStamina) * 100)}%`;
  const w = activeWeapon();
  document.getElementById('weapon-name').textContent = w.label;
  if (w.kind === 'melee') {
    document.getElementById('ammo').innerHTML = `<span class="reserve">MELEE</span>`;
  } else {
    document.getElementById('ammo').innerHTML = `${w.ammo} <span class="reserve">/ ${w.reserve}</span>`;
  }
  const grenadeEl = document.getElementById('grenade-count');
  if (grenadeEl) grenadeEl.textContent = `💣 x${player.grenades}`;
  document.getElementById('score').textContent = player.score.toLocaleString();
  if (player.turned) {
    updateZombieHUD();
  } else {
    document.getElementById('wave-count').textContent = wave;
    const remaining = enemies.filter(e => e.alive).length + Math.max(0, enemiesRemainingToSpawn - enemies.length);
    document.getElementById('enemies-left').textContent = `${Math.max(0, remaining)} zombies remaining`;
  }
  renderAllyHUD();

  const vignette = document.getElementById('vignette');
  const hpPct = player.health / player.maxHealth;
  if (hpPct < 0.35) {
    vignette.style.boxShadow = `inset 0 0 ${160 - hpPct * 200}px 40px rgba(255,0,0,${0.5 - hpPct * 0.6})`;
  } else {
    vignette.style.boxShadow = 'inset 0 0 160px 40px rgba(255,0,0,0)';
  }
  if (player.alive && hpPct < 0.3 && hpPct > 0) startHeartbeat(); else stopHeartbeat();
}

function addKillFeed(text, color) {
  const feed = document.getElementById('killfeed');
  const item = document.createElement('div');
  item.className = 'kf-item';
  item.style.color = color || '#fff';
  item.textContent = text;
  feed.appendChild(item);
  setTimeout(() => item.remove(), 3300);
  while (feed.children.length > 5) feed.removeChild(feed.firstChild);
}

function showBanner(text, sub) {
  const banner = document.getElementById('banner');
  document.getElementById('banner-text').textContent = text;
  document.getElementById('banner-sub').textContent = sub;
  banner.classList.add('show');
  setTimeout(() => banner.classList.remove('show'), 2600);
}

let shakeTime = 0, shakeMag = 0, shakeRoll = 0;
function screenShake(mag) { shakeTime = 0.22; shakeMag = mag; }

function applyDamageToPlayer(amount) {
  if (!player.alive) return;
  amount *= difficulty.dmg;
  if (player.shield > 0) {
    const absorbed = Math.min(player.shield, amount);
    player.shield -= absorbed;
    amount -= absorbed;
  }
  player.health -= amount;
  if (amount > 0) playPlayerHurt();
  updateHUD();
  if (player.health <= 0) {
    player.health = 0;
    turnIntoZombie();
  }
}

function triggerHumanWin() {
  player.alive = false;
  stopHeartbeat();
  controls.unlock();
  overlay.classList.remove('hidden');
  document.getElementById('overlay-title').textContent = 'Outbreak Contained';
  document.getElementById('overlay-body').style.display = 'none';
  const lockNote = document.getElementById('lock-note');
  if (lockNote) lockNote.style.display = 'none';
  const stats = document.getElementById('gameover-stats');
  stats.style.display = 'block';
  stats.innerHTML = `You held the line for <span>30 waves</span> and made it out. Final score: <span>${player.score.toLocaleString()}</span>.`;
  startBtn.textContent = 'Play Again';
  playWaveClear();
}

startBtn.addEventListener('click', () => {
  if (!player.alive) location.reload();
});

// ---------------------------------------------------------------------------
// Turning into a zombie — death isn't game over the first time. The horde
// stops caring about you, but the remaining survivors (ground + rooftop +
// anyone else in the neighborhood) now see YOU as the threat and fight back.
// Infect 100 of them to win; let them kill you and it's over for real.
// ---------------------------------------------------------------------------
const ZOMBIE_HEALTH = 220;
const SURVIVOR_WIN_TARGET = 100;
let infectedCount = 0;
let infectCooldown = 0;
const wildSurvivors = [];

function allyEngagePlayer(ally, dt, opts) {
  const playerPos = controls.getObject().position;
  const dist = ally.root.position.distanceTo(playerPos);
  const facing = playerPos.clone().sub(ally.root.position);
  facing.y = 0;
  if (facing.lengthSq() > 0.0001) {
    const lookAngle = Math.atan2(facing.x, facing.z);
    ally.root.rotation.y = THREE.MathUtils.lerp(ally.root.rotation.y, lookAngle, opts.turnSpeed);
  }
  if (dist < opts.range) {
    ally.fireCooldown -= dt;
    if (ally.fireCooldown <= 0) {
      ally.fireCooldown = opts.cooldownMin + Math.random() * opts.cooldownJitter;
      const from = ally.root.position.clone().add(new THREE.Vector3(0, opts.muzzleY, 0));
      spawnTracer(from, playerPos.clone(), 0xff8a6b);
      playGunshot(from, opts.vol, opts.pitch);
      applyDamageToZombiePlayer(opts.dmgMin + Math.random() * opts.dmgJitter);
    }
  }
  return dist;
}

function applyDamageToZombiePlayer(amount) {
  if (!player.alive || !player.turned) return;
  amount *= difficulty.dmg;
  player.health -= amount;
  playPlayerHurt();
  screenShake(0.14);
  updateHUD();
  if (player.health <= 0) {
    player.health = 0;
    endZombieGame(false);
  }
}

function turnIntoZombie() {
  player.turned = true;
  player.alive = true;
  player.health = ZOMBIE_HEALTH;
  player.maxHealth = ZOMBIE_HEALTH;
  player.shield = 0;

  waveActive = false;
  if (currentSpawnInterval) clearInterval(currentSpawnInterval);
  for (const e of enemies) { e.alive = false; scene.remove(e.root); }
  enemies.length = 0;

  fenceGroup.visible = false;
  for (const a of [...allies, ...rooftopAllies]) {
    const base = a.root.position.clone();
    scene.remove(a.root);
    if (rooftopAllies.includes(a)) base.set(LADDER_X + 1.8, 0, LADDER_Z + (Math.random() - 0.5) * 3);
    spawnZombieAlly(base);
  }
  allies.length = 0;
  rooftopAllies.length = 0;
  renderAllyHUD();
  for (let i = 0; i < 10; i++) spawnWildSurvivor(true);

  renderer.domElement.style.filter = 'saturate(0.65) sepia(0.25) hue-rotate(58deg) contrast(1.0) brightness(0.9)';
  showBanner('YOU HAVE TURNED', `Your allies turned with you — spread through the neighborhood and infect ${SURVIVOR_WIN_TARGET} survivors`);
  addKillFeed('You and your squad are now infected', '#aaff3c');
  playZombieDeath(camera.position);
  updateZombieHUD();
}

function tryInfect() {
  if (!player.alive || !player.turned || infectCooldown > 0) return;
  infectCooldown = 0.7;
  markAttack();
  const origin = camera.position.clone();
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);

  const pool = survivorPool();
  let closest = null, closestDist = Infinity;
  for (const s of pool) {
    const toS = s.root.position.clone().add(new THREE.Vector3(0, 1.0, 0)).sub(origin);
    const dist = toS.length();
    if (dist > 2.0) continue;
    const facing = toS.clone().normalize().dot(dir);
    if (facing > 0.5 && dist < closestDist) { closestDist = dist; closest = s; }
  }
  playHitTick();
  if (!closest) return;

  removeSurvivor(closest, 'You infected a survivor');
  flashCrosshairHit();
}

function survivorPool() {
  return [...allies, ...rooftopAllies, ...wildSurvivors];
}

// Weapons hurt survivors once you've turned; a kill counts the same as a bite.
function hostileTargets() {
  return player.turned ? survivorPool() : enemies;
}
function damageTarget(t, amount, message = 'You took out a survivor') {
  if (!player.turned) { damageEnemy(t, amount); return; }
  t.health -= amount;
  if (t.bar) t.bar.userData.draw(Math.max(0, t.health / t.maxHealth), '#4df0ff');
  if (t.health <= 0) removeSurvivor(t, message);
}

function removeSurvivor(s, message) {
  if (!s.alive) return;
  s.alive = false;
  scene.remove(s.root);
  for (const arr of [allies, rooftopAllies, wildSurvivors]) {
    const idx = arr.indexOf(s);
    if (idx !== -1) arr.splice(idx, 1);
  }
  infectedCount++;
  playZombieGroan(s.root.position, 1);
  addKillFeed(`${message} (${infectedCount}/${SURVIVOR_WIN_TARGET})`, '#aaff3c');
  renderAllyHUD();
  updateZombieHUD();
  if (infectedCount >= SURVIVOR_WIN_TARGET) endZombieGame(true);
}

function spawnWildSurvivor(initial = false) {
  const root = buildCharacter('survivor');
  const playerPos = controls.getObject().position;
  let spot = null;
  for (let i = 0; i < 12 && !spot; i++) {
    const h = neighborhoodHouses[Math.floor(Math.random() * neighborhoodHouses.length)];
    if (!h) break;
    const ang = Math.random() * Math.PI * 2, off = 8 + Math.random() * 5;
    const x = h.x + Math.cos(ang) * off, z = h.z + Math.sin(ang) * off;
    const d = Math.hypot(x - playerPos.x, z - playerPos.z);
    if (d > (initial ? 16 : 28) && d < 85) spot = [x, z];
  }
  if (!spot) { const a = Math.random() * Math.PI * 2; spot = [Math.cos(a) * 60, Math.sin(a) * 60]; }
  root.position.set(spot[0], 0, spot[1]);
  scene.add(root);
  const bar = makeHealthBarSprite();
  bar.position.set(0, 2.0, 0);
  bar.userData.draw(1, '#4df0ff');
  root.add(bar);
  wildSurvivors.push({ root, bar, alive: true, maxHealth: 80, health: 80, fireCooldown: Math.random(), walkT: Math.random() * 10, wanderDir: Math.random() * Math.PI * 2, wanderT: Math.random() * 4 });
}

function updateWildSurvivor(s, dt) {
  if (!s.alive) return;
  if (recoverIfCorrupted(s.root.position, new THREE.Vector3(ARENA_RADIUS - 2, 0, 0))) return;
  const dist = allyEngagePlayer(s, dt, { turnSpeed: 0.1, range: 14, muzzleY: 1.4, cooldownMin: 1.0, cooldownJitter: 0.6, dmgMin: 5, dmgJitter: 4, vol: 0.4, pitch: 1.5 });
  const desired = new THREE.Vector3();
  if (dist < 5) {
    const away = s.root.position.clone().sub(controls.getObject().position);
    away.y = 0;
    if (away.lengthSq() > 0.001) desired.copy(away.normalize()).multiplyScalar(1.8 * dt);
  } else if (dist > 16) {
    // Out of sight: drift around the streets.
    s.wanderT -= dt;
    if (s.wanderT <= 0) { s.wanderT = 3 + Math.random() * 4; s.wanderDir = Math.random() * Math.PI * 2; }
    desired.set(Math.sin(s.wanderDir), 0, Math.cos(s.wanderDir)).multiplyScalar(1.0 * dt);
    s.root.rotation.y = THREE.MathUtils.lerp(s.root.rotation.y, s.wanderDir, 0.05);
  }
  s.root.position.add(desired);
  collideObstacles(s.root.position, 0.5);
  collideHouseWalls(s.root.position, 0.5);
  s.walkT += dt * (desired.length() > 0.001 ? 1 : 0.0);
  animateWalk(s.root, s.walkT, 1);
  s.bar.lookAt(camera.position);
}

// Your former allies: infected along with you. They hunt survivors and bite.
const zombieAllies = [];
function spawnZombieAlly(pos) {
  const root = buildCharacter('zombie');
  root.position.set(pos.x, 0, pos.z);
  scene.add(root);
  const bar = makeHealthBarSprite();
  bar.position.set(0, 2.0, 0);
  bar.userData.draw(1, '#aaff3c');
  root.add(bar);
  zombieAllies.push({ root, bar, alive: true, attackCooldown: 0, walkT: Math.random() * 10 });
}

function updateZombieAlly(z, dt) {
  if (!z.alive) return;
  if (recoverIfCorrupted(z.root.position, controls.getObject().position)) return;
  z.voiceT = (z.voiceT ?? 1 + Math.random() * 4) - dt;
  if (z.voiceT <= 0) { z.voiceT = 4 + Math.random() * 6; playZombieVoice(z.root.position); }
  const playerPos = controls.getObject().position;
  let prey = null, preyDist = Infinity;
  for (const s of wildSurvivors) {
    if (!s.alive) continue;
    const d = z.root.position.distanceTo(s.root.position);
    if (d < preyDist) { preyDist = d; prey = s; }
  }
  const targetPos = prey && preyDist < 70 ? prey.root.position : playerPos;
  const to = targetPos.clone().sub(z.root.position);
  to.y = 0;
  const dist = to.length();
  const stopAt = prey && preyDist < 70 ? 1.5 : 3.5;
  let moved = false;
  if (dist > stopAt) {
    to.normalize();
    z.root.position.addScaledVector(to, 3.2 * dt);
    z.root.rotation.y = THREE.MathUtils.lerp(z.root.rotation.y, Math.atan2(to.x, to.z), 0.15);
    moved = true;
  }
  collideObstacles(z.root.position, 0.5);
  collideHouseWalls(z.root.position, 0.5);
  if (moved) z.walkT += dt;
  animateWalk(z.root, z.walkT, 1.2);
  if (prey && preyDist < 1.9) {
    z.attackCooldown -= dt;
    if (z.attackCooldown <= 0) {
      z.attackCooldown = 0.9;
      playZombieGroan(z.root.position, 0.4);
      damageTarget(prey, 28, 'Your horde infected a survivor');
    }
  }
  z.bar.lookAt(camera.position);
}

setInterval(() => {
  if (player.turned && player.alive && infectedCount < SURVIVOR_WIN_TARGET && wildSurvivors.filter(s => s.alive).length < 14) {
    spawnWildSurvivor();
  }
}, 1800);

function updateZombieHUD() {
  const remaining = Math.max(0, SURVIVOR_WIN_TARGET - infectedCount);
  document.getElementById('wave-label').textContent = 'Infect';
  document.getElementById('wave-count').textContent = infectedCount;
  document.getElementById('enemies-left').textContent = `${remaining} survivors left to infect`;
  document.getElementById('hud-top-center').style.display = 'block';
}

function endZombieGame(won) {
  player.alive = false;
  stopHeartbeat();
  controls.unlock();
  overlay.classList.remove('hidden');
  document.getElementById('overlay-title').textContent = won ? 'Outbreak Complete' : 'Put Down';
  document.getElementById('overlay-body').style.display = 'none';
  const lockNote = document.getElementById('lock-note');
  if (lockNote) lockNote.style.display = 'none';
  const stats = document.getElementById('gameover-stats');
  stats.style.display = 'block';
  stats.innerHTML = won
    ? `You infected all <span>${SURVIVOR_WIN_TARGET}</span> survivors. The outbreak has spread.`
    : `The survivors finished you off after you infected <span>${infectedCount}</span> of them.`;
  startBtn.textContent = 'Play Again';
}

// ---------------------------------------------------------------------------
// Post-processing (bloom for emissive glow / muzzle flash realism)
// ---------------------------------------------------------------------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.4, 0.9);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// Cinematic grade: desaturated teal/orange split-toning, vignette, chromatic
// fringe, film grain — the muted, gritty look of modern military shooters.
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c,c);
      vec2 off = c * r2 * 0.012;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(l), col, 0.78);
      col = mix(col, col * vec3(0.92,1.0,1.08), 1.0 - smoothstep(0.0, 0.6, l));
      col = mix(col, col * vec3(1.08,1.0,0.9), smoothstep(0.4, 1.0, l));
      col = (col - 0.5) * 1.05 + 0.5;
      col = pow(col, vec3(0.88));
      col *= 1.0 - smoothstep(0.3, 0.9, r2 * 2.2) * 0.38;
      col += (hash(vUv * 1600.0 + time) - 0.5) * 0.045;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(gradePass);
composer.addPass(new SMAAPass(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio()));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function updateMovement(dt) {
  const obj = controls.getObject();
  // Defensive: if position/velocity ever goes non-finite (shouldn't happen,
  // but a corrupted camera quaternion or a stray NaN from an edge case could
  // do it), recover to the house interior rather than leaving a dead black
  // screen with no way out.
  if (!Number.isFinite(obj.position.x) || !Number.isFinite(obj.position.y) || !Number.isFinite(obj.position.z)) {
    obj.position.set(0, STAND_HEIGHT, PLAYER_SPAWN_Z);
    player.velocity.set(0, 0, 0);
    player.sliding = false;
  }
  const sprintReady = !player.crouching && !player.sliding && keys['ShiftLeft'] && player.stamina > 1 && (keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD']);
  player.sprinting = sprintReady;

  let moveVec = new THREE.Vector3();
  if (player.sliding) {
    player.slideTimer -= dt;
    if (player.slideTimer <= 0) player.sliding = false;
    const slideT = Math.max(0, player.slideTimer / SLIDE_DURATION);
    const speed = SLIDE_SPEED * slideT;
    controls.moveRight(player.slideDir.x * speed * dt);
    controls.moveForward(-player.slideDir.z * speed * dt);
  } else {
    const baseSpeed = player.speed * (activePowerups.speed ? 1.5 : 1) * (sprintReady ? 1.6 : 1) * (player.crouching ? 0.5 : 1) * (player.aiming ? 0.6 : 1);
    const damping = 10;
    player.velocity.x -= player.velocity.x * damping * dt;
    player.velocity.z -= player.velocity.z * damping * dt;

    const forward = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
    const right = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
    moveVec = new THREE.Vector3(right, 0, -forward);
    if (moveVec.lengthSq() > 0) moveVec.normalize();

    player.velocity.x -= moveVec.x * baseSpeed * 10 * dt * -1;
    player.velocity.z -= moveVec.z * baseSpeed * 10 * dt;

    controls.moveRight(moveVec.x * baseSpeed * dt);
    controls.moveForward(-moveVec.z * baseSpeed * dt);
  }

  // gravity / jump / ladder climb
  const onRoofDeck = isOverPlatform(obj.position) && obj.position.y > ROOF_Y + STAND_HEIGHT - 0.5;
  if (isOnLadder(obj.position) && keys['Space'] && !onRoofDeck) {
    player.velocity.y = 3.2;
    player.canJump = false;
  } else {
    player.velocity.y -= 24 * dt;
    if (keys['Space'] && player.canJump && !player.crouching) {
      player.velocity.y = 8.4;
      player.canJump = false;
    }
  }
  obj.position.y += player.velocity.y * dt;
  player.eyeHeight = THREE.MathUtils.lerp(player.eyeHeight, player.crouching ? CROUCH_HEIGHT : STAND_HEIGHT, 0.18);
  const floorY = onRoofDeck ? ROOF_Y + player.eyeHeight : player.eyeHeight;
  if (obj.position.y <= floorY) {
    obj.position.y = floorY;
    player.velocity.y = 0;
    player.canJump = true;
  }

  collideObstacles(obj.position, player.radius);
  collideHouseWalls(obj.position, player.radius);

  // stamina
  if (sprintReady) player.stamina = Math.max(0, player.stamina - dt * 22);
  else player.stamina = Math.min(player.maxStamina, player.stamina + dt * 14);

  // view bob
  const moving = moveVec.lengthSq() > 0 && player.canJump;
  const bobVM = activeViewModel();
  if (moving) {
    const bobT = performance.now() * 0.012 * (sprintReady ? 1.6 : 1);
    bobVM.group.position.y = bobVM.basePos.y + Math.sin(bobT) * 0.012;
    bobVM.group.position.x = bobVM.basePos.x + Math.cos(bobT * 0.5) * 0.006;
    footstepTimer -= dt;
    if (footstepTimer <= 0) {
      playFootstep();
      footstepTimer = sprintReady ? 0.24 : 0.36;
    }
  } else {
    bobVM.group.position.y = THREE.MathUtils.lerp(bobVM.group.position.y, bobVM.basePos.y, 0.1);
    bobVM.group.position.x = THREE.MathUtils.lerp(bobVM.group.position.x, bobVM.basePos.x, 0.1);
  }
}

function updateWeaponVisuals(dt) {
  const scoping = player.aiming && currentWeapon === 'rifle';
  camera.fov = THREE.MathUtils.lerp(camera.fov, scoping ? 30 : 72, 0.2);
  camera.updateProjectionMatrix();
  document.getElementById('crosshair').style.display = scoping ? 'none' : '';

  const vm = activeViewModel();
  vm.group.position.z = THREE.MathUtils.lerp(vm.group.position.z, vm.basePos.z, 0.25);
  if (vm.muzzleLight) vm.muzzleLight.intensity = THREE.MathUtils.lerp(vm.muzzleLight.intensity, 0, 0.35);
  if (vm.muzzleFlash) vm.muzzleFlash.material.opacity = THREE.MathUtils.lerp(vm.muzzleFlash.material.opacity, 0, 0.4);

  if (currentWeapon === 'knife') {
    knifeSwing = THREE.MathUtils.lerp(knifeSwing, 0, 0.25);
    vm.group.rotation.x = -knifeSwing * 0.9;
    vm.group.rotation.z = knifeSwing * 0.3;
  }

  if (infectCooldown > 0) infectCooldown -= dt;

  const w = activeWeapon();
  if (w.cooldown > 0) w.cooldown -= dt;
  if (mouseDown && controls.isLocked && w.cooldown <= 0 && player.alive) {
    fireActive();
  }
}

function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const tr = tracers[i];
    tr.life -= dt;
    tr.line.material.opacity = Math.max(0, tr.life / 0.08);
    if (tr.life <= 0) {
      scene.remove(tr.line);
      tr.line.geometry.dispose();
      tr.line.material.dispose();
      tracers.splice(i, 1);
    }
  }
}

// Shake is applied as a transient render-time roll only — it must never be written
// into camera.rotation/.quaternion persistently, since PointerLockControls owns that
// state (via its own internal Euler math) to enforce the up/down look clamp. Writing
// rotation.z directly there fought with it and could drift into an upside-down view.
function updateCameraShake(dt) {
  if (shakeTime > 0) {
    shakeTime -= dt;
    const m = shakeMag * (shakeTime / 0.22);
    shakeRoll = (Math.random() - 0.5) * m;
  } else {
    shakeRoll = THREE.MathUtils.lerp(shakeRoll, 0, 0.2);
  }
}

let hudTick = 0;
let lastWaveCheck = 0;
const _cleanQuat = new THREE.Quaternion();


// ---------------------------------------------------------------------------
// Minimap — rotates with the player's heading (up = where you're looking)
// ---------------------------------------------------------------------------
const minimapCanvas = document.getElementById('minimap');
const mmCtx = minimapCanvas.getContext('2d');
const MM_SIZE = 180; // pixel size; range (world units centre->edge) widens once you've turned
const _mmDir = new THREE.Vector3();
function updateMinimap() {
  const pPos = controls.getObject().position;
  camera.getWorldDirection(_mmDir);
  const yaw = Math.atan2(_mmDir.x, -_mmDir.z);
  const scale = (MM_SIZE / 2) / (player.turned ? 75 : 42);
  const toMap = (wx, wz) => {
    const dx = wx - pPos.x, dz = wz - pPos.z;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [MM_SIZE / 2 + (dx * c - dz * s) * scale, MM_SIZE / 2 + (dx * s + dz * c) * scale];
  };
  const g = mmCtx;
  g.clearRect(0, 0, MM_SIZE, MM_SIZE);
  g.save();
  g.beginPath(); g.arc(MM_SIZE / 2, MM_SIZE / 2, MM_SIZE / 2 - 1, 0, Math.PI * 2); g.clip();
  g.fillStyle = 'rgba(10,16,12,0.82)'; g.fillRect(0, 0, MM_SIZE, MM_SIZE);

  const [ax, az] = toMap(0, 0);
  g.strokeStyle = 'rgba(160,140,100,0.5)'; g.lineWidth = 2;
  g.beginPath(); g.arc(ax, az, (ARENA_RADIUS + 1.5) * scale, 0, Math.PI * 2); g.stroke();

  g.save();
  const [hx, hz] = toMap(0, HOUSE_Z);
  g.translate(hx, hz); g.rotate(yaw);
  g.fillStyle = 'rgba(205,190,150,0.75)';
  g.fillRect(-HOUSE_HW * scale, -HOUSE_HD * scale, HOUSE_HW * 2 * scale, HOUSE_HD * 2 * scale);
  g.restore();

  const dot = (x, z, color, r) => {
    const [mx, mz] = toMap(x, z);
    g.fillStyle = color; g.beginPath(); g.arc(mx, mz, r, 0, Math.PI * 2); g.fill();
  };
  const ap = AMMO_STATION.position;
  dot(ap.x, ap.z, '#ffd23c', 4);
  for (const p of powerups) dot(p.mesh.position.x, p.mesh.position.z, p.type.key === 'housekey' ? '#ffe066' : '#7cff8a', 2.5);
  for (const e of enemies) if (e.alive) dot(e.root.position.x, e.root.position.z, '#ff4d3c', 3);
  for (const a of allies) dot(a.root.position.x, a.root.position.z, '#4dc8ff', 3);
  for (const a of rooftopAllies) dot(a.root.position.x, a.root.position.z, '#4dc8ff', 3);
  g.fillStyle = 'rgba(150,140,110,0.7)';
  for (const h of neighborhoodHouses) {
    const [hx2, hz2] = toMap(h.x, h.z);
    g.fillRect(hx2 - 4 * scale, hz2 - 4 * scale, 8 * scale, 8 * scale);
  }
  for (const z of zombieAllies) dot(z.root.position.x, z.root.position.z, '#aaff3c', 3);
  for (const w of wildSurvivors) if (w.alive) dot(w.root.position.x, w.root.position.z, '#ff9e3c', 3);
  g.restore();

  g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2;
  g.beginPath(); g.arc(MM_SIZE / 2, MM_SIZE / 2, MM_SIZE / 2 - 1, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(MM_SIZE / 2, MM_SIZE / 2 - 8); g.lineTo(MM_SIZE / 2 + 5, MM_SIZE / 2 + 5); g.lineTo(MM_SIZE / 2 - 5, MM_SIZE / 2 + 5);
  g.closePath(); g.fill();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (controls.isLocked && player.alive) {
    updateMovement(dt);
    for (const e of enemies) updateEnemyAI(e, dt);
    for (const a of allies) updateAllyAI(a, dt, t);
    for (const ra of rooftopAllies) updateRooftopAlly(ra, dt);
    for (const s of wildSurvivors) updateWildSurvivor(s, dt);
    for (const z of zombieAllies) updateZombieAlly(z, dt);
    updateGrenades(dt);
    updatePowerups(dt, t);
    updateRegen(dt);
    updateInteractPrompt(dt);
  }

  gradePass.uniforms.time.value = t % 100;
  skyDome.position.copy(camera.position);
  updateLampLights(dt);
  updateMinimap();
  updateWeaponVisuals(dt);
  updateTracers(dt);
  updateCharacterMixers(dt);
  updateCameraShake(dt);

  sunLight.target.position.copy(controls.getObject().position);
  sunLight.position.copy(sunLight.target.position).addScaledVector(sun, 120);

  hudTick += dt;
  if (hudTick > 0.15) { hudTick = 0; updateHUD(); renderPowerupTray(); }

  // Apply the damage-shake roll for this rendered frame only, then restore the
  // real orientation immediately — PointerLockControls must only ever see the
  // roll-free quaternion, or its pitch clamp can drift over time.
  if (shakeRoll !== 0) {
    _cleanQuat.copy(camera.quaternion);
    camera.rotateZ(shakeRoll);
    composer.render();
    camera.quaternion.copy(_cleanQuat);
  } else {
    composer.render();
  }
}

// ---------------------------------------------------------------------------
await loadHumanModels();

// Boot
// ---------------------------------------------------------------------------
document.getElementById('loading').style.display = 'none';

// ---- Main menu ----------------------------------------------------------
{
  const menu = document.getElementById('main-menu');
  const panels = { main: document.getElementById('menu-main'), diff: document.getElementById('menu-diff-panel'), tut: document.getElementById('menu-tut-panel') };
  const show = which => { for (const [k, el] of Object.entries(panels)) el.classList.toggle('hidden', k !== which); };
  const label = { easy: 'Easy', intermediate: 'Intermediate', hard: 'Hard' };
  const refresh = () => {
    document.getElementById('menu-difficulty').textContent = `Difficulty: ${label[difficultyKey]}`;
    document.querySelectorAll('[data-diff]').forEach(b => b.classList.toggle('selected', b.dataset.diff === difficultyKey));
  };
  refresh();
  document.getElementById('menu-difficulty').addEventListener('click', () => show('diff'));
  document.getElementById('menu-tutorials').addEventListener('click', () => show('tut'));
  document.getElementById('diff-back').addEventListener('click', () => show('main'));
  document.getElementById('tut-back').addEventListener('click', () => show('main'));
  document.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', () => {
    difficultyKey = b.dataset.diff;
    difficulty = DIFFICULTIES[difficultyKey];
    try { localStorage.setItem('zw_difficulty', difficultyKey); } catch (e) { /* storage unavailable */ }
    refresh();
  }));
  document.getElementById('menu-start').addEventListener('click', () => {
    menu.classList.add('hidden');
    startBtn.click();
  });
}
spawnAlly(Math.PI * 0.75);
spawnAlly(-Math.PI * 0.75);
spawnRooftopAlly(HOUSE_Z - 1.3);
spawnRooftopAlly(HOUSE_Z + 1.3);
spawnHouseKey();
updateHUD();
renderPowerupTray();
animate();
