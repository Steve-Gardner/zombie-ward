# Zombie Ward

A 3D first-person zombie survival shooter you can play in your browser. Created by **BlindWolf**.

**Play:** open the game's web address in Chrome or Edge on a computer and click to start.
Once it has loaded, you can install it as an app from the browser's address bar and it will also work offline.

## Phones and tablets
The game detects touch devices automatically (Android and iPhone/iPad) and switches to on-screen controls:
a floating thumbstick on the left (push it all the way to run), drag on the right to look, and buttons for fire, aim, jump, duck, use, reload, grenade, weapon swap and pause.
Aim assist gently pulls the view toward zombies near the crosshair. Graphics quality also adapts: phones start at Medium and the game steps down by itself if it runs slowly.
Use the **Controls** and **Graphics** buttons on the main menu to override either. Hold the phone sideways. On iPhone, use Share, then Add to Home Screen for full-screen play.

## Controls on a computer
Move with WASD, look with the mouse, click to fire, right-click to aim, R to reload, G for a grenade, E to interact, 1/2/3 to switch weapons. The in-game Tutorials page has the full list.

## For whoever edits the game
* The game code is `game.js` (plus `touch.js` for phone controls and `quality.js` for graphics tiers); the page is `index.html` and `touch.css`.
* After any change run `python3 build.py` (it refreshes `sw.js`), then commit and push. GitHub Pages republishes automatically in about a minute.
* The 3D library (Three.js, MIT licence) is bundled in `vendor/` so the game works offline.
