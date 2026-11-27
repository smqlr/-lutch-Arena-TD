# Clutch Arena TD

A tactical 3D tower defense set in an esports arena. Build a squad of five pros, place them anywhere off the
enemy route — ground, rooftops, crates, containers — and hold the plant site against 15 enemy types,
from eco rushers and lag-jumping ping abusers to cheaters, flash trolls and the Spinbot boss.

**▶ Play online: https://smqlr.github.io/-lutch-Arena-TD/**

Built with TypeScript, Vite, Three.js, Tailwind CSS and the Web Audio API. Made for web game portals
(CrazyGames, Poki); English by default, Russian available in Settings.

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

## GitHub Pages

Every push to `main` builds the game and publishes it to GitHub Pages
(`.github/workflows/deploy-pages.yml`; Settings → Pages → Source must be set to **GitHub Actions**).

## CrazyGames and Poki

Each portal gets its own build with only its SDK inside (`src/sdk/`):

```bash
npm run build:crazygames   # dist-crazygames/ — CrazyGames HTML5 SDK v3
npm run build:poki         # dist-poki/ — Poki SDK v2
npm run release            # both builds + release/clutch-arena-td-crazygames.zip and -poki.zip
```

The archives have `index.html` at the root and forward-slash paths (`scripts/pack.mjs`, no extra dependencies).

- Rewarded ads: +credits in the menu, airdrop in a match, double credits after a match.
- CrazyGames: `midgame` ad after the results screen (the SDK limits frequency), loading and gameplay events,
  `happytime` on victory, the portal's mute setting and cloud save through the data module.
- Poki: `commercialBreak` before every match start (Poki decides when an ad actually plays), loading and gameplay
  events; on `localhost` the SDK runs in debug mode with simulated ads.
- With an ad blocker the game keeps working, but rewarded buttons give nothing. On a plain site (`npm run build`,
  GitHub Pages) there is no SDK and rewarded ads are simulated by a countdown window.
- The in-game fullscreen button is hidden on the portals: they provide their own.
- In the dev build pick a portal with `?platform=crazygames` or `?platform=poki`.

## Project layout

- `src/data` — units, enemies, wave generator, maps
- `src/engine` — map builder, characters, poses and weapon holds, camera, effects, sound
- `src/game` — match logic, free placement, routes, saves
- `src/ui` — main menu, HUD, labels, overlays
- `PROGRESS.md` — design notes and balance knobs (in Russian)
