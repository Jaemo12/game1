# Neon Arena

A small first-person shooter that runs in the browser. Play solo against AI bots, or **online with friends** in rooms you share by link.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000. To use another port, run `node server.js 3123`.

**Controls:** WASD move · Shift sprint · C crouch (hold) / slide (press while running) · Space jump · E plant/defuse · Left click shoot · Right click aim/scope (knife: heavy stab) · 1–8 or wheel switch weapon · Q last weapon · R reload · Tab scores · F flashbang · G smoke · V frag · X ping · T quick chat · Esc menu

Ctrl is deliberately not used: browsers treat Ctrl+W as "close tab" and a web page can't reliably stop that. If the tab is about to close mid-match, the game asks first. Press F11 for fullscreen.

## Play online with friends

1. Open the game and pick the mode, map and number of bots.
2. Click **Create room & invite friends**, then **Copy link**, and send it to your friends (WhatsApp etc.).
3. Friends open the link, pick a name and avatar, and press **JOIN ROOM**.

How it works: whoever creates the room is the **host**. Their browser runs the match (bots, health, kills, rounds) and the server only passes messages along, which is why it fits on free hosting. **The host must keep their game tab open.** If they leave, the room closes. In team modes people are split across Blue and Red and bots fill the gaps. Friends can join mid-match (in Demolition, from the next round).

### Put it online for free (Render, Frankfurt)

1. Go to https://render.com and sign up with your GitHub account. The free plan doesn't need a card.
2. Click **New +** > **Blueprint**, choose this repository, and click **Apply**. It reads `render.yaml` and creates a free web service in Frankfurt.
3. When the first deploy finishes (a few minutes), open the `https://...onrender.com` address it shows. That's the link you and your friends use.
4. Every `git push` to `main` redeploys automatically.

Free plan note: the server **sleeps after 15 minutes with nobody on it**. The first person to open the link after that waits about 30 to 60 seconds while it wakes up. After that it's normal speed.

## Game modes

- **Free-for-all:** everyone for themselves, first to 20 kills.
- **Team Deathmatch:** Blue vs Red, first team to 30 kills (6 minute cap). No friendly fire.
- **Demolition:** round-based. Attackers carry a charge to bombsite A or B and plant it (hold E, 3.5 s). It detonates after 40 s unless a defender defuses it (hold E, 6 s). No respawns within a round, so you spectate a teammate after dying. First to 4 rounds wins, and sides swap at halftime.

**Demolition economy:** everyone starts with $800 and a pistol. Kills pay $300, a round win $3000, a loss $1900, and planting $300 (max $9000). Press **B** during the freeze and the first 15 s of a round to open the buy menu, then a number key (0 and - for the last two) to buy: Hand Cannon $700, Hornet SMG $1700, Scatter Gun $1200, Trident Burst $2400, Pulse Rifle $2900, Rail Sniper $4700, Armor $1000 (soaks up part of each hit). You keep what you bought if you survive the round and lose it if you die. Money resets at halftime. Prices and rewards are in `ECONOMY` and `WEAPONS` in `public/map.js`.

**Pickups (Free-for-all / Team Deathmatch):** medkits (+50 HP) and ammo boxes (refill spare ammo) on every map, respawning 20 s after being taken. Guns now have limited spare ammo (shown as "30 / 90").

**Grenades:** flashbang (blinds anyone who looks at it, including you), smoke (a 12 s cloud that blocks sight, bots included) and frag (up to about 115 damage, less with distance, needs a clear line). In Free-for-all and Team Deathmatch you spawn with one of each. In Demolition buy them in the menu (flash $200 x2, smoke $300, frag $400); you keep them if you survive the round. Bots buy and throw frags and flashes too.

()=>`()=>`**Maps:** Dusk Yard, Harbor, Neon Alley, Neon Academy, Sunset Split, and two big strategic Demolition maps. **Dune Bazaar** (88 m, sunny): five routes north (a long west lane, a narrow alley, a covered souk in the middle, a tight east alley and an east lane), two sites with two doors each (B also has a window to jump through) and a high ledge over each site, reached with a step crate. **Foundry** (80 m, dark industrial): a pipe alley on the west, a walled hall in the middle with a catwalk you climb from either end that covers both door lines, and a container maze on the east with stacks you can climb. Both have named callouts for the minimap and chat.

**Gun feel:** every gun kicks the model back, up and sideways on springs and punches the camera, with weight that matches the gun (a pistol snaps, the Hand Cannon and shotgun thump, the sniper slams). Spraying climbs your aim in a pattern you can learn, the first shot is the most accurate, and brass or shells fly out. Reloads show the mag swap and racking, weapons pull out at different speeds, shotguns pump, and getting hit knocks your view. **Sniper:** right click toggles the scope (click again for more zoom, again to leave it). It is only accurate fully scoped in, sways a little (more when moving), drops the scope while the bolt cycles after a shot, one-shots to the body (110 damage, mostly ignores armor) and moves you slower while scoped. The feel numbers are in `FEEL` in `public/game.js`.

**Weapons:**` Pulse Rifle (all-rounder), Scatter Gun (close range), Rail Sniper, Volt Pistol, Hand Cannon, Arc Blade (knife), **Hornet SMG** (very fast, good while moving, weak at range) and **Trident Burst** (one click fires 3 quick shots, accurate at distance).

**Characters, colors and skins:** 7 avatars (Kaze, Boss Mango, Glitch, Nyx, Governor Gull, Oni, Ember). In the menu you can also pick a **color** (changes the glow and your color in free-for-all) and a **gun skin** (recolors the glowing parts and muzzle flash of your guns). Both are saved, and friends see your color.

**Bot personalities:** each bot has a style. *Rushers* run at you with SMGs and shotguns, *Snipers* hold a spot and watch with the Rail Sniper, *Anchors* hold ground with rifles and burst rifles, *Flankers* roam. In team modes bots call out enemies ("Enemy spotted · A Main") in the chat log, and in Demolition attackers buy smokes and throw one onto the bombsite before planting. Tuning is in \`PERSONAS\` in \`public/game.js\`.

**Minimap:**` top-left, north is up. It shows you, your teammates, the bombsites and the charge. Enemies appear only while you or a teammate can see them (smoke hides them). The name of the area you are in shows under it. Area names for each map are in `callouts` in `public/map.js` (maps without them show sites, mid and spawns).

**Pings and quick chat:** press **X** to ping the spot you are looking at (a marker with your name and the distance, visible through walls for 8 s, also on the minimap). Press **T** and then a number for a preset message (Rush A, Need help, Enemy spotted and so on, with your location added). In team modes only teammates see them. Messages appear on the left under the minimap.

**End of match:** a scoreboard with kills, deaths, headshots and damage for everyone, the MVP (kills, headshots and damage count for, deaths count against), and your own accuracy. The kill feed shows a small icon for each weapon, grenade or bomb blast.

**Sound:** footsteps for everyone (crouch-walking is silent), panned left/right and muffled with distance so you can hear where enemies are. Guns have layered sounds with echo, shotgun pumps and sniper bolts.

**Settings** (button in the menu): field of view, crosshair style and color, and key bindings for movement and actions.

In team modes, bots split Red/Blue. 3 bots = 2v2, 5 = 3v3, 7 = 4v4. Mode rules (limits, timers) are in the `MODES` table in `public/game.js`, and bombsites and team spawns are in each map in `public/map.js`.

## Files

| File | What it is |
|---|---|
| `public/game.js` | The whole game: graphics, movement, shooting, bots, HUD, sounds |
| `public/avatars.js` | The 7 characters (Kaze, Boss Mango, Glitch, Nyx, Governor Gull, Oni, Ember): shapes, colors, walk animation. Add new avatars here. |
| `public/textures.js` | Procedural textures made in code: asphalt, concrete, containers, crates, steel, hazard stripes, gunmetal, polymer, walnut |
| `public/atmosphere.js` | The look: sky, rain, ripples, light motes, lamps, neon signs, hologram, wet floor, glowing trims, color grading |
| `public/nav.js` | Bot pathfinding (A* on a 1 m grid) so bots walk around buildings |
| `public/audio.js` | All sound, made in code: layered gunshots, footsteps, reloads, reverb, ambience |
| `public/map.js` | The maps (layout, spawns, look), weapon stats, health, respawn time |
| `public/index.html` | Menu and HUD layout/styles |
| `server.js` | Serves the files and relays multiplayer rooms (create/join by 4-letter code) |
| `public/net.js` | The browser side of the multiplayer connection |
| `render.yaml` | Free hosting setup for Render (Frankfurt) |

## Easy things to tweak

- **Maps:** seven maps live in `MAPS` in `public/map.js` (Dusk Yard, Harbor, Neon Alley, Neon Academy, Sunset Split, Dune Bazaar, Foundry), chosen in the menu. Each has `boxes` (`x`/`z` = center, `y` = bottom, `w`/`h`/`d` = size, `t` = material: concrete, barrier, crate, container, steel, brick, `p` = paint, `c` = small neon accent), `spawns`, and an `env` block for its look (sky, fog, sun, lamps, signs, rain). To add a map, copy one entry and change it. Players jump about 1.4 m, so taller spots need a crate to climb.
- **Glow:** the bloom settings are on the `UnrealBloomPass` line in `public/game.js` (strength, radius, threshold).
- **Weapons:** `WEAPONS` in `public/map.js` has the Pulse Rifle, Scatter Gun, Rail Sniper, Volt Pistol, Hand Cannon, Hornet SMG, Trident Burst and Arc Blade (knife). Each one's damage, fire rate, spread, zoom, recoil, magazine and reload time are there, with a comment explaining every field. Bot versions of the weapons are tuned in `BOT_GUNS` in `public/game.js`.
- **Bot difficulty:** the `DIFF` table near the top of `public/game.js`.
- **Movement:** the `MOVE` table in `public/game.js` (walk/sprint/crouch speed, slide boost, length and friction), plus `JUMP` and `GRAV`.

## Testing

Add `?test` to the URL to skip mouse capture and expose `window.__arena` (with `step(n)` to advance n frames). This is used for automated checks.
