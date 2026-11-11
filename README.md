# Neon Arena

A small neon first-person shooter that runs in the browser. Right now it's **single-player against AI bots**. Multiplayer for friends comes later.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000. To use another port, run `node server.js 3123`.

**Controls:** WASD move · Shift sprint · C crouch (hold) / slide (press while running) · Space jump · Left click shoot · Right click aim/scope (knife: heavy stab) · 1–6 or wheel switch weapon · Q last weapon · R reload · Tab scores · Esc menu

Ctrl is deliberately not used: browsers treat Ctrl+W as "close tab" and a web page can't reliably stop that. If the tab is about to close mid-match, the game asks first. Press F11 for fullscreen.

## Files

| File | What it is |
|---|---|
| `public/game.js` | The whole game: graphics, movement, shooting, bots, HUD, sounds |
| `public/avatars.js` | The 4 characters (Kaze, Boss Mango, Glitch, Nyx): shapes, colors, walk animation. Add new avatars here. |
| `public/textures.js` | Procedural textures made in code: asphalt, concrete, containers, crates, steel, hazard stripes, gunmetal, polymer, walnut |
| `public/atmosphere.js` | The look: sky, rain, ripples, light motes, lamps, neon signs, hologram, wet floor, glowing trims, color grading |
| `public/map.js` | Arena layout (boxes, spawns), weapon stats, health, respawn time |
| `public/index.html` | Menu and HUD layout/styles |
| `server.js` | Serves the files. It also has early multiplayer code that the game doesn't use yet. |

## Easy things to tweak

- **Map:** edit `BOXES` in `public/map.js`. `x`/`z` = center, `y` = bottom, `w`/`h`/`d` = size, `t` = material (concrete, barrier, crate, container, steel), `p` = paint color, `c` = small neon accent.
- **Glow:** the bloom settings are on the `UnrealBloomPass` line in `public/game.js` (strength, radius, threshold).
- **Weapons:** `WEAPONS` in `public/map.js` has the Pulse Rifle, Scatter Gun, Rail Sniper, Volt Pistol, Hand Cannon and Arc Blade (knife). Each one's damage, fire rate, spread, zoom, recoil, magazine and reload time are there, with a comment explaining every field. Bot versions of the weapons are tuned in `BOT_GUNS` in `public/game.js`.
- **Bot difficulty:** the `DIFF` table near the top of `public/game.js`.
- **Movement:** the `MOVE` table in `public/game.js` (walk/sprint/crouch speed, slide boost, length and friction), plus `JUMP` and `GRAV`.

## Testing

Add `?test` to the URL to skip mouse capture and expose `window.__arena` (with `step(n)` to advance n frames). This is used for automated checks.
