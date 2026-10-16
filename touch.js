// ===================== touch controls (phones / tablets) =====================
// Left thumb: floating stick (move; push it all the way to run). Right thumb: drag anywhere to look.
// Buttons: fire, aim, jump, crouch, use, reload, grenade, weapon swap, bite (zombie only), pause.
// On PCs none of this is active unless "Controls" is switched to Touch in the main menu.
import * as THREE from 'three';

export const touch = { on: false, move: { x: 0, y: 0 }, firing: false };

const CTL_KEY = 'zw_controls';                 // "auto" | "touch" | "keyboard"
const SENS = 0.0042;                           // radians of turn per pixel dragged
const STICK_R = 56;                            // px the thumbstick can travel
const CTL_LABEL = { auto: 'Auto', touch: 'Touch', keyboard: 'Keyboard' };
let ctlSetting = 'auto';
try { ctlSetting = localStorage.getItem(CTL_KEY) || 'auto'; } catch (e) { /* storage unavailable */ }

function detect() {
  const q = new URLSearchParams(location.search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  if (ctlSetting === 'touch') return true;
  if (ctlSetting === 'keyboard') return false;
  const mm = s => window.matchMedia && matchMedia(s).matches;
  const ua = navigator.userAgent || '';
  const mobileUA = /Android|iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return mobileUA || (mm('(pointer: coarse)') && !mm('(any-pointer: fine)'));
}

touch.on = detect();
document.body.classList.toggle('touch', touch.on);

const BUTTONS = [
  { id: 'tFire', label: 'FIRE', cls: 'big' },
  { id: 'tAim', label: 'AIM', cls: 'mid' },
  { id: 'tJump', label: 'JUMP', cls: 'mid' },
  { id: 'tCrouch', label: 'DUCK', cls: 'sm' },
  { id: 'tUse', label: 'USE', cls: 'mid' },
  { id: 'tReload', label: 'RELOAD', cls: 'sm' },
  { id: 'tGren', label: 'GRENADE', cls: 'sm' },
  { id: 'tSwap', label: 'RIFLE', cls: 'sm' },
  { id: 'tBite', label: 'BITE', cls: 'sm' },
  { id: 'tPause', label: 'II', cls: 'pause' },
];

export function initTouch({ camera, controls, player, keys, getTargets, getWeapon }) {
  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = '<div id="stickBase"><div id="stickKnob"></div></div>' +
    BUTTONS.map(b => `<div class="tb ${b.cls}" id="${b.id}"><span>${b.label}</span></div>`).join('');
  document.body.appendChild(root);
  const $ = id => document.getElementById(id);
  const stickBase = $('stickBase'), stickKnob = $('stickKnob');

  const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  const tapKey = code => { key(code, true); key(code, false); };
  const mouse = (type, button) => document.dispatchEvent(new MouseEvent(type, { button, bubbles: true }));

  // ---- looking: same maths as PointerLockControls so the pitch clamp still applies
  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const clampPitch = x => Math.max(Math.PI / 2 - controls.maxPolarAngle, Math.min(Math.PI / 2 - controls.minPolarAngle, x));
  function look(dx, dy) {
    const s = SENS * (player.aiming ? 0.5 : 1);
    _e.setFromQuaternion(camera.quaternion);
    _e.y -= dx * s; _e.x = clampPitch(_e.x - dy * s);
    camera.quaternion.setFromEuler(_e);
  }

  // ---- full-screen gesture layer: left side = thumbstick, right side = look
  let stickId = null, lookId = null, sox = 0, soy = 0, lx = 0, ly = 0;
  const setRun = on => { keys['ShiftLeft'] = on; };
  function stickAt(x, y) {
    const dx = x - sox, dy = y - soy, len = Math.hypot(dx, dy), m = Math.min(1, len / STICK_R);
    const mag = m < 0.12 ? 0 : (m - 0.12) / 0.88, a = Math.atan2(dy, dx);
    touch.move.x = Math.cos(a) * mag; touch.move.y = -Math.sin(a) * mag;
    setRun(m > 0.96);
    const k = Math.min(len, STICK_R);
    stickKnob.style.transform = `translate(${Math.cos(a) * k}px, ${Math.sin(a) * k}px)`;
  }
  function stickEnd() {
    stickId = null; touch.move.x = 0; touch.move.y = 0; setRun(false);
    stickBase.style.display = 'none'; stickKnob.style.transform = '';
  }
  root.addEventListener('pointerdown', e => {
    if (e.target.closest('.tb')) return;
    e.preventDefault();
    if (e.clientX < innerWidth * 0.42 && stickId === null) {
      stickId = e.pointerId; sox = e.clientX; soy = e.clientY;
      stickBase.style.display = 'block'; stickBase.style.left = sox + 'px'; stickBase.style.top = soy + 'px';
      stickAt(sox, soy);
    } else if (lookId === null) { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; }
    else return;
    try { root.setPointerCapture(e.pointerId); } catch (err) { /* no active pointer (synthetic event) */ }
  });
  root.addEventListener('pointermove', e => {
    if (e.pointerId === stickId) { e.preventDefault(); stickAt(e.clientX, e.clientY); }
    else if (e.pointerId === lookId) { e.preventDefault(); look(e.clientX - lx, e.clientY - ly); lx = e.clientX; ly = e.clientY; }
  });
  const up = e => { if (e.pointerId === stickId) stickEnd(); else if (e.pointerId === lookId) lookId = null; };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);

  // ---- buttons
  let fireId = null, fx = 0, fy = 0;
  function bind(id, down, upFn, drag) {
    const el = $(id); let pid = null;
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      if (pid !== null) return;
      pid = e.pointerId; try { el.setPointerCapture(pid); } catch (err) { /* synthetic event */ } el.classList.add('on'); down(e);
    });
    if (drag) el.addEventListener('pointermove', e => { if (e.pointerId === pid) drag(e); });
    const end = e => { if (e.pointerId !== pid) return; pid = null; el.classList.remove('on'); if (upFn) upFn(e); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  bind('tFire',
    e => { touch.firing = true; fx = e.clientX; fy = e.clientY; mouse('mousedown', 0); },
    () => { touch.firing = false; mouse('mouseup', 0); },
    e => { look(e.clientX - fx, e.clientY - fy); fx = e.clientX; fy = e.clientY; });   // keep dragging to aim while firing
  bind('tAim', () => { if (getWeapon() !== 'rifle') return; mouse(player.aiming ? 'mouseup' : 'mousedown', 2); });
  bind('tJump', () => key('Space', true), () => key('Space', false));
  bind('tUse', () => key('KeyE', true), () => key('KeyE', false));          // hold to repair, tap to lock/unlock/board
  bind('tCrouch', () => tapKey('CapsLock'));
  bind('tReload', () => tapKey('KeyR'));
  bind('tGren', () => tapKey('KeyG'));
  bind('tBite', () => tapKey('KeyF'));
  bind('tSwap', () => tapKey({ knife: 'Digit2', pistol: 'Digit3', rifle: 'Digit1' }[getWeapon()]));
  bind('tPause', () => controls.unlock());

  function releaseAll() {
    stickEnd(); lookId = null;
    if (touch.firing) { touch.firing = false; mouse('mouseup', 0); }
    keys['Space'] = false; keys['KeyE'] = false;
    document.querySelectorAll('#touch .tb.on').forEach(b => b.classList.remove('on'));
  }
  controls.addEventListener('unlock', releaseAll);

  document.addEventListener('contextmenu', e => { if (touch.on) e.preventDefault(); });
  document.addEventListener('visibilitychange', () => { if (touch.on && document.hidden && controls.isLocked) controls.unlock(); });

  // ---- rotate-your-phone hint
  const rot = document.createElement('div');
  rot.id = 'rotateHint'; rot.innerHTML = '<div><div class="ri">&#8635;</div>Turn your phone sideways to play</div>';
  document.body.appendChild(rot);

  // ---- per-frame: show/hide, aim assist
  const o = new THREE.Vector3(), d = new THREE.Vector3(), v = new THREE.Vector3();
  let lastWeapon = '';
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  function update(dt) {
    const live = touch.on && controls.isLocked;
    root.style.display = live ? 'block' : 'none';
    if (!live) return;
    if (matchMedia('(orientation: portrait)').matches && innerHeight > innerWidth) { controls.unlock(); return; }
    const w = getWeapon();
    if (w !== lastWeapon) { lastWeapon = w; $('tSwap').firstChild.textContent = w.toUpperCase(); $('tAim').style.visibility = w === 'rifle' ? '' : 'hidden'; }
    $('tBite').style.display = player.turned ? '' : 'none';
    $('tAim').classList.toggle('on', player.aiming);
    // aim assist: while firing or aiming, ease the view toward the nearest target close to the crosshair
    if (!player.alive || !(touch.firing || player.aiming)) return;
    camera.getWorldPosition(o); camera.getWorldDirection(d);
    let best = null, bestAng = player.aiming ? 0.17 : 0.12;
    for (const t of getTargets()) {
      if (!t.alive) continue;
      v.set(t.root.position.x, t.root.position.y + 1.05, t.root.position.z).sub(o);
      const dist = v.length(); if (dist > 45 || dist < 0.5) continue;
      const ang = d.angleTo(v);
      if (ang < bestAng) { bestAng = ang; best = { dist, x: v.x, y: v.y, z: v.z }; }
    }
    if (!best) return;
    const k = 1 - Math.exp(-dt * (touch.firing ? 6 : 4));
    _e.setFromQuaternion(camera.quaternion);
    _e.y += wrap(Math.atan2(-best.x, -best.z) - _e.y) * k * 0.6;
    _e.x = clampPitch(_e.x + (Math.asin(best.y / best.dist) - _e.x) * k * 0.6);
    camera.quaternion.setFromEuler(_e);
  }

  function enterFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    }).catch(() => {});
  }

  // ---- main-menu "Controls" button
  const ctlBtn = $('ctlBtn');
  const refreshCtl = () => { ctlBtn.textContent = `Controls: ${CTL_LABEL[ctlSetting]}`; };
  refreshCtl();
  ctlBtn.addEventListener('click', () => {
    ctlSetting = { auto: 'touch', touch: 'keyboard', keyboard: 'auto' }[ctlSetting];
    try { localStorage.setItem(CTL_KEY, ctlSetting); } catch (e) { /* storage unavailable */ }
    touch.on = detect(); document.body.classList.toggle('touch', touch.on); refreshCtl();
  });

  return { update, enterFullscreen };
}
