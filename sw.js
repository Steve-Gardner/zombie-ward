// Service worker: lets the game install as an app and run offline.
// index.html and game.js are fetched fresh whenever you're online (so updates show up right away); everything else comes from the cache.
const VERSION = "zw-1792185236";
const ASSETS = ["./", "./index.html", "./game.js", "./manifest.webmanifest", "./models/Soldier.glb", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./vendor/three/build/three.module.js", "./vendor/three/examples/jsm/controls/PointerLockControls.js", "./vendor/three/examples/jsm/loaders/GLTFLoader.js", "./vendor/three/examples/jsm/objects/Sky.js", "./vendor/three/examples/jsm/postprocessing/EffectComposer.js", "./vendor/three/examples/jsm/postprocessing/MaskPass.js", "./vendor/three/examples/jsm/postprocessing/OutputPass.js", "./vendor/three/examples/jsm/postprocessing/Pass.js", "./vendor/three/examples/jsm/postprocessing/RenderPass.js", "./vendor/three/examples/jsm/postprocessing/SMAAPass.js", "./vendor/three/examples/jsm/postprocessing/ShaderPass.js", "./vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js", "./vendor/three/examples/jsm/shaders/CopyShader.js", "./vendor/three/examples/jsm/shaders/LuminosityHighPassShader.js", "./vendor/three/examples/jsm/shaders/OutputShader.js", "./vendor/three/examples/jsm/shaders/SMAAShader.js", "./vendor/three/examples/jsm/utils/BufferGeometryUtils.js", "./vendor/three/examples/jsm/utils/SkeletonUtils.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const isPage = req.mode === "navigate" || req.url.endsWith("/index.html") || req.url.endsWith("/game.js") || req.url.endsWith("/sw.js");
  if (isPage) {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return r; }).catch(() => caches.match(req).then(r => r || caches.match("./index.html"))));
  } else {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; })));
  }
});
