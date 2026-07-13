# ShinobiX

![CI](https://github.com/Timehue/ShinobiX/actions/workflows/ci.yml/badge.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22-2f7d32)
![TypeScript](https://img.shields.io/badge/TypeScript-game%20server%20%2B%20client-3178c6)
![Beta](https://img.shields.io/badge/status-public%20beta%20candidate-c47716)

ShinobiX is a browser-based ninja MMORPG built around long-term character
growth, jutsu combat, missions, clans, pets, village systems, towers, ranked
PvP, and live-service progression loops.

The playable client currently presents itself as **Shinobi Journey** while the
repository and backend package use the **ShinobiX** name.

![ShinobiX demo preview](docs/screenshots/demo.gif)

## Why Star This Repo

Star ShinobiX if you want to follow a serious browser MMORPG codebase as it
moves toward public beta. The project is already more than a landing page: it
has a real React client, an Express/Supabase backend, server-side reward and
anti-cheat checks, and a broad automated test suite covering combat, missions,
economy, PvP, saves, pets, towers, village systems, and release gates.

## Gameplay

- Create a shinobi with a village, starter bloodline, avatar, jutsu kit, and
  protected save.
- Train stats and jutsu, take missions and hunts, manage inventory, recover at
  the hospital, and build long-term progression through the Logbook.
- Fight with AP-based tactical combat, movement, jutsu, weapons, consumables,
  effects, cooldowns, battle logs, and server-validated reward paths.
- Join social and competitive systems including clans, ranked PvP, pet arena,
  battle towers, card clash, village leadership, and sector-war foundations.
- Operate beta safely with release flags, audit logs, receipts, rate limits,
  beta metrics, and admin diagnostics.

## Screenshots

| Character creation | Tactical combat |
| --- | --- |
| ![Character creator](docs/screenshots/character-creator.png) | ![Combat screen](docs/screenshots/combat.png) |

## Current Status

ShinobiX is a **public beta candidate**, not a finished MMO launch. The core
early loop is ready enough for controlled testing after live smoke checks pass.
Some high-risk systems should remain gated or staff-monitored until they have
fresh production evidence.

Ready for controlled beta:

- Registration, login, character creation, and Academy onboarding.
- Training, jutsu training, inventory, shop, bank, hospital, cafeteria.
- Early missions, early hunts, Logbook goals, village map, and world travel.
- PvP, ranked PvP, battle towers, pet arena, professions, and clans with
  monitoring.

Gate or soft-launch:

- Weekly Boss rewards until server-authoritative damage settlement is enabled.
- High-value client-resolved combat mission rewards.
- Broad village/sector-war seasons without staff coverage.
- Player AI image generation, creator tools, and public Bloodline Maker usage.
- Hollow Gate as a mobile-ready feature.

See [Public Beta Launch Recommendation](PUBLIC_BETA_LAUNCH_RECOMMENDATION.md)
and [Feature Flag Release Matrix](FEATURE_FLAG_RELEASE_MATRIX.md).

## Tech Stack

- Backend: Node 22, Express 5, TypeScript, Supabase/Postgres, Socket.IO.
- Client: Vite, React 19, TypeScript, Three.js, React Three Fiber.
- Operations: cPanel/Railway deployment notes, health checks, release flags,
  audit logs, Sentry integration, and build-size checks.
- Testing: Node test runner plus TypeScript/tsx tests across API modules,
  combat engines, economy, PvP, missions, pets, towers, village systems, and
  client libraries.

## Quick Start

Requires Node.js 22 or newer.

```bash
npm ci
npm test
```

Run the local client:

```bash
cd shinobij.client
npm ci
npm run dev
```

Vite starts on a local HTTPS URL such as:

```text
https://127.0.0.1:5173/
```

Build everything:

```bash
npm run build
```

The full build compiles the server, builds the client, verifies the deployment
bundle, and runs the build-size check.

## Project Layout

- `api/` - gameplay APIs, combat systems, storage, auth, rewards, telemetry,
  realtime helpers, and beta hardening.
- `shinobij.client/` - Vite/React game client.
- `docs/` - architecture plans, release audits, balance notes, and roadmap.
- `scripts/` - catalog validation, asset helpers, release checks, simulations,
  and migration utilities.
- `dist/` - generated deployment output.

## Roadmap

The public roadmap is in [docs/ROADMAP.md](docs/ROADMAP.md). The first release
target is a conservative `v0.1.0-beta` cut focused on the early game, core
combat, player safety, observability, and honest beta labeling.

## Release Notes

Draft release notes for the first beta are in
[docs/RELEASE_NOTES_v0.1.0-beta.md](docs/RELEASE_NOTES_v0.1.0-beta.md).

## Media Kit

Repository screenshots and capture notes live in
[docs/MEDIA_KIT.md](docs/MEDIA_KIT.md). The current README GIF is generated
from verified local screenshots so visitors see real app screens instead of
stock art.

## Community

- Discord: https://discord.gg/bCQGs8r6SK
- Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md)
- Release readiness: [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)

## License

No open-source license is declared in this repository yet. Until a license is
added, assume all code and assets are under exclusive copyright and cannot be
redistributed or reused without permission.
