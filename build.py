#!/usr/bin/env python3
"""Writes sw.js (the offline cache list). Run `python3 build.py` after any change, then commit and push to publish."""
import json, pathlib, time
root = pathlib.Path(__file__).parent
stamp = str(int(time.time()))
assets = ["./", "./index.html", "./game.js", "./touch.js", "./quality.js", "./touch.css", "./manifest.webmanifest", "./models/Soldier.glb", "./audio/wolf-howl.mp3",
          "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png"]
assets += ["./" + str(p.relative_to(root)) for p in sorted((root / "vendor").rglob("*.js"))]
sw = (root / "sw.template.js").read_text().replace("__VERSION__", "zw-" + stamp).replace("__ASSETS__", json.dumps(assets))
(root / "sw.js").write_text(sw)
print(f"built sw.js ({len(assets)} cached files)")
