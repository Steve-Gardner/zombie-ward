# Zombie Ward

A 3D first-person zombie survival shooter you can play in your browser. Created by **BlindWolf**.

**Play:** open the game's web address in Chrome or Edge on a computer and click to start.
It is designed for keyboard and mouse. Once it has loaded, you can install it as an app from the browser's address bar and it will also work offline.

## For whoever edits the game
* The game code is `game.js`; the page is `index.html`.
* After any change run `python3 build.py` (it refreshes `sw.js`), then commit and push. GitHub Pages republishes automatically in about a minute.
* The 3D library (Three.js, MIT licence) is bundled in `vendor/` so the game works offline.
