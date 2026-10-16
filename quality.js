// ===================== graphics quality tiers (automatic, with manual override) =====================
// PCs keep the original look (High). Phones start at Medium and step down by themselves if the game runs slowly.
import { touch } from './touch.js';

const LEVELS = [
  { name: 'High',   pr: () => Math.min(window.devicePixelRatio, touch.on ? 2 : 3), shadow: 4096, bloom: true,  smaa: true },
  { name: 'Medium', pr: () => Math.min(window.devicePixelRatio, 1.25),             shadow: 2048, bloom: true,  smaa: false },
  { name: 'Low',    pr: () => 0.75,                                                shadow: 1024, bloom: false, smaa: false },
];
const GFX_KEY = 'zw_gfx';                       // "auto" | "high" | "medium" | "low"
const ORDER = ['auto', 'high', 'medium', 'low'];

export function initQuality({ renderer, composer, sunLight, bloomPass, smaaPass }) {
  let setting = 'auto', cur = -1, warm = 0, acc = 0, frames = 0, slow = 0, last = performance.now();
  try { setting = localStorage.getItem(GFX_KEY) || 'auto'; } catch (e) { /* storage unavailable */ }
  const btn = document.getElementById('gfxBtn');
  const label = () => { btn.textContent = `Graphics: ${setting === 'auto' ? 'Auto' : LEVELS[cur].name}`; };

  function apply(i) {
    if (i === cur) return;
    cur = i; warm = 120; acc = 0; frames = 0; slow = 0;
    const q = LEVELS[i], pr = q.pr();
    renderer.setPixelRatio(pr); composer.setPixelRatio(pr);
    sunLight.shadow.mapSize.set(q.shadow, q.shadow);
    if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
    bloomPass.enabled = q.bloom; smaaPass.enabled = q.smaa;
    renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
    label();
  }
  const pick = () => (setting === 'auto' ? (touch.on ? 1 : 0) : ORDER.indexOf(setting) - 1);

  // PCs with Auto skip the call entirely so they run exactly as before
  if (touch.on || setting !== 'auto') apply(pick()); else { cur = 0; label(); }

  btn.addEventListener('click', () => {
    setting = ORDER[(ORDER.indexOf(setting) + 1) % ORDER.length];
    try { localStorage.setItem(GFX_KEY, setting); } catch (e) { /* storage unavailable */ }
    const i = pick(); cur === i ? label() : apply(i);
  });

  // Called every frame while playing: if a phone averages under ~26 fps for two seconds running, drop one tier.
  return function tick(playing) {
    const now = performance.now(), dt = (now - last) / 1000; last = now;
    if (!playing || !touch.on || setting !== 'auto' || dt > 0.5) return;
    if (warm > 0) { warm--; return; }
    acc += dt; frames++;
    if (acc < 2) return;
    slow = frames / acc < 26 ? slow + 1 : 0; acc = 0; frames = 0;
    if (slow >= 2 && cur < LEVELS.length - 1) apply(cur + 1);
  };
}
