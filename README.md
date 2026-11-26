# Clutch Arena TD

A tactical 3D tower defense set in an esports arena. Build a squad of five pros, place them anywhere off the
enemy route — ground, rooftops, crates, containers — and hold the plant site against 15 enemy types,
from eco rushers and lag-jumping ping abusers to cheaters, flash trolls and the Spinbot boss.

Built with TypeScript, Vite, Three.js, Tailwind CSS and the Web Audio API. Made for Yandex Games
(English by default, Russian available in Settings).

## Features

- 5 original arenas (Bazaar, Dune Citadel, Old Quarter, Reactor, Interchange) with multiple routes
- 30 units in 5 roles (AWPer, Entry Fragger, IGL, Support, Lurker), 3 weapon tiers each, unique passives
  and signature poses
- 15 enemies with their own mechanics: smoke, lag, DDoS drones, screamers, toxic auras, flashes, dodging
  cheaters, AFK tanks and a shielded boss
- Free placement with a high-ground bonus, force-buy, airdrops, interest, auto-waves and 2× speed
- Tactical and free-flight cameras, procedural models, textures and sound — no external assets

## Running

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build at http://localhost:4173
```

On Windows PowerShell with script execution disabled, use `npm.cmd` instead of `npm`.

## Yandex Games

`release/clutch-arena-td-yandex.zip` contains the production build with `index.html` at the root.
To rebuild it, run `npm run build` and zip the **contents** of `dist/` with forward-slash paths.
The Yandex SDK (`/sdk.js`) loads only on Yandex domains or with the `?ysdk=1` query parameter.

## Project layout

- `src/data` — units, enemies, wave generator, maps
- `src/engine` — map builder, characters, poses and weapon holds, camera, effects, sound
- `src/game` — match logic, free placement, routes, saves
- `src/ui` — main menu, HUD, labels, overlays
- `PROGRESS.md` — design notes and balance knobs (in Russian)
