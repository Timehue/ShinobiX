# Shinobi Journey Client

This is the Vite/React client for ShinobiX. The public game UI currently uses
the **Shinobi Journey** brand while the repository and backend package use the
**ShinobiX** name.

![Client demo preview](../docs/screenshots/demo.gif)

## What This Client Contains

- Cinematic landing page, login, character creator, and guide/leaderboard entry
  points.
- Main game shell with profile, currencies, menu navigation, mobile nav, and
  save/logout flow.
- Core play screens for village, missions, training, jutsu, inventory, combat,
  PvP, towers, pets, clans, professions, card clash, world map, and late-game
  systems.
- Local development API middleware for saves, auth, presence, village guard,
  and image-generation endpoints.
- Client-side tests for stats, progression, jutsu, inventory, combat UI helpers,
  pets, towers, Hollow Gate, cards, notifications, and beta guards.

## Requirements

- Node.js 22 or newer.
- Root dependencies installed if you are running the full repo build.

## Local Development

```bash
cd shinobij.client
npm ci
npm run dev
```

The dev server starts on a local HTTPS URL, usually:

```text
https://127.0.0.1:5173/
```

Vite may create or reuse a local development certificate.

## Scripts

```bash
npm run dev      # Start Vite locally
npm run build    # Type-check and build the client
npm run lint     # Run ESLint
npm run preview  # Preview the production build
```

## Screenshots

Repository media lives in `../docs/screenshots/`.

| Character creation | Tactical combat |
| --- | --- |
| ![Character creator](../docs/screenshots/character-creator.png) | ![Combat screen](../docs/screenshots/combat.png) |

## Notes For Contributors

- Keep game screenshots grounded in real local or staging captures.
- Prefer existing screen and UI patterns before adding new visual systems.
- Treat combat, rewards, currency, saves, and creator tools as
  balance-sensitive surfaces.
- Run the focused client tests for any change touching `src/lib`, combat UI,
  progression, or save behavior.
