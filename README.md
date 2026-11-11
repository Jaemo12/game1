# Neon Arena

A small neon first-person shooter that runs in the browser. Right now it's **single-player against AI bots**. Multiplayer for friends comes later.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000. To use another port, run `node server.js 3123`.

**Controls:** WASD move · Shift sprint · C crouch (hold) / slide (press while running) · Space jump · E plant/defuse · Left click shoot · Right click aim/scope (knife: heavy stab) · 1–6 or wheel switch weapon · Q last weapon · R reload · Tab scores · Esc menu

Ctrl is deliberately not used: browsers treat Ctrl+W as "close tab" and a web page can't reliably stop that. If the tab is about to close mid-match, the game asks first. Press F11 for fullscreen.

## Game modes

- **Free-for-all:** everyone for themselves, first to 20 kills.
- **Team Deathmatch:** Blue vs Red, first team to 30 kills (6 minute cap). No friendly fire.
- **Demolition:** round-based. Attackers carry a charge to bombsite A or B and plant it (hold E, 3.5 s). It detonates after 40 s unless a defender defuses it (hold E, 6 s). No respawns within a round, so you spectate a teammate after dying. First to 4 rounds wins, and sides swap at halftime.

In team modes, bots split Red/Blue. 3 bots = 2v2, 5 = 3v3, 7 = 4v4. Mode rules (limits, timers) are in the `MODES` table in `public/game.js`, and bombsites and team spawns are in each map in `public/map.js`.

## Files

| File | What it is |
|---|---|
| `public/game.js` | The whole game: graphics, movement, shooting, bots, HUD, sounds |
| `public/avatars.js` | The 4 characters (Kaze, Boss Mango, Glitch, Nyx): shapes, colors, walk animation. Add new avatars here. |
| `public/textures.js` | Procedural textures made in code: asphalt, concrete, containers, crates, steel, hazard stripes, gunmetal, polymer, walnut |
| `public/atmosphere.js` | The look: sky, rain, ripples, light motes, lamps, neon signs, hologram, wet floor, glowing trims, color grading |
| `public/nav.js` | Bot pathfinding (A* on a 1 m grid) so bots walk around buildings |
| `public/map.js` | The maps (layout, spawns, look), weapon stats, health, respawn time |
| `public/index.html` | Menu and HUD layout/styles |
| `server.js` | Serves the files. It also has early multiplayer code that the game doesn't use yet. |

## Easy things to tweak

- **Maps:** three maps live in `MAPS` in `public/map.js` (Dusk Yard, Harbor, Neon Alley), chosen in the menu. Each has `boxes` (`x`/`z` = center, `y` = bottom, `w`/`h`/`d` = size, `t` = material: concrete, barrier, crate, container, steel, brick, `p` = paint, `c` = small neon accent), `spawns`, and an `env` block for its look (sky, fog, sun, lamps, signs, rain). To add a map, copy one entry and change it. Players jump about 1.4 m, so taller spots need a crate to climb.
- **Glow:** the bloom settings are on the `UnrealBloomPass` line in `public/game.js` (strength, radius, threshold).
- **Weapons:** `WEAPONS` in `public/map.js` has the Pulse Rifle, Scatter Gun, Rail Sniper, Volt Pistol, Hand Cannon and Arc Blade (knife). Each one's damage, fire rate, spread, zoom, recoil, magazine and reload time are there, with a comment explaining every field. Bot versions of the weapons are tuned in `BOT_GUNS` in `public/game.js`.
- **Bot difficulty:** the `DIFF` table near the top of `public/game.js`.
- **Movement:** the `MOVE` table in `public/game.js` (walk/sprint/crouch speed, slide boost, length and friction), plus `JUMP` and `GRAV`.

## Testing

Add `?test` to the URL to skip mouse capture and expose `window.__arena` (with `step(n)` to advance n frames). This is used for automated checks.
