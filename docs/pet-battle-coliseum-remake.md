# Pet Battle Coliseum Remake — Handoff

> Status: **PLANNED, not started.** This doc is the full handoff so a fresh
> session can begin cold. Written 2026-06-10.

## The goal

Remake pet battles so it **looks like elemental pets are actually fighting in a
coliseum** — real movement (pets advance/retreat/lunge), attack animations,
elemental VFX flying between them, camera shake/hit-stop, a living scene. Not the
current static-sprite turn display.

## Guiding principle (do NOT violate)

**Keep the deterministic combat ENGINE. Rebuild only the PRESENTATION.** The
battle math is server-validated and replayable. The new animated scene must be
**driven by the existing event queue** and stay purely cosmetic — the visual
layer must never affect outcomes. Battles stay fair/deterministic.

## What already exists (verified this session — this is why it's feasible)

The previous dev left the renderer **pre-architected for exactly this**:

- **`shinobij.client/src/components/PetBattleAvatar.tsx`** — the in-battle pet
  renderer. Tiered "most-dimensional-first" sprite modes:
  - `spriteSheet` → key `petsheet:<id>` (+ `petsheet:<id>:frames`, 1–24, default 8)
    — a horizontal animation strip played via CSS `steps()`. Comment literally
    calls it *"Phase C — the AI-3D-baked slot."*
  - `layeredParallax` → keys `petlayers:<id>:far|mid|near` — depth-sliced 2.5D
    parallax stack (*"Phase B 2.5D billboard"*).
  - `fullBodySprite` → key `petbody:<id>` — single transparent full-body PNG.
  - `circleFallback` → legacy clipped portrait orb.
  - All assets are read from `sharedImages` (the `shared:img` store, served via
    `/api/img`). Key helpers + prefixes live in
    **`shinobij.client/src/lib/pet-battle-anim.ts`**.
- **`petBattleChoreograph`** (in `pet-battle-anim.ts`, ~line 182) — *"Pure +
  deterministic. Returns [] or a list of events"* to choreograph a battle frame.
  **THIS is the animation driver.** First task in the new session: read it and
  document the exact event shape — that's the contract the new scene consumes.
- **`shinobij.client/src/assets/fx/<effect>/*.png`** — a ~400-frame **elemental
  VFX library already in the repo**: fire, water, lightning, explosion, snow,
  wind, heal, burn, splash, tornado, aura, charge, earth, swirl, blood, bighit,
  buff, eshield, etc. This is the elemental combat VFX — already done.
- Battle screens: **`src/screens/PetArena.tsx`**, **`src/screens/Arena.tsx`**;
  arena grid layouts in **`src/constants/pet-arena.ts`** (cell-index grids).
- Existing sprite tooling: `scripts/derive-pet-battle-sprites.mjs`,
  `scripts/slice-battle-vfx.mjs`.
- Pet portraits: `pet:<id>` shared images (and `pet.image`).

## Recommended architecture (the honest best-for-an-AI-to-build path)

- **Renderer: PixiJS (2D WebGL) via `@pixi/react`.** Right tool for an animated
  coliseum — moving sprites + heavy particle/elemental VFX + shader glows at
  60fps. CSS/DOM (the current approach) will not hold up for "real fighting."
  Integrates cleanly with React 19 + Vite.
  - *Alternative:* `react-three-fiber` (Three.js) with **billboarded 2D sprites**
    = the "HD-2D / Octopath Traveler" look with a real 3D camera that can pan/zoom
    the arena. More wow, more complexity. **Start with Pixi**; r3f is the upgrade
    path if a true 3D camera is wanted.
- **Driver:** the existing deterministic event queue (`petBattleChoreograph`).
  Map each event → a scene action (advance, lunge, cast-element, take-hit, faint).
- **VFX:** reuse the `fx/` frame library (Pixi `AnimatedSprite` from the existing
  frame PNGs). Generate any *extra* effects via the OpenAI pipeline.
- **Backgrounds:** generate the coliseum scene(s) via `scripts/gen-asset.mjs`
  (OpenAI pipeline, already proven this session).

## The real bottleneck = animated CREATURE assets (be honest with the user)

The **scene** is high-confidence and squarely buildable. The hard part is
animated pets — AI cannot yet produce clean rigged, game-ready animated
creatures. There is a ladder; climb it incrementally:

1. **Procedural (today, FREE, no new deps):** code-driven motion on the EXISTING
   pet images — slide to engage, lunge on attack, recoil/shake on hit,
   squash-stretch, elemental aura, plus `fx/` VFX + camera shake. Reads
   convincingly as "fighting with movement." **Start here to prove the feel.**
2. **AI sprite-sheets (needs a fal.ai/Replicate token):** image-to-video
   (Kling / Runway / Stable Video / Wan) → extract frames → fill the wired
   `petsheet:<id>` slot. Real animation, imperfect frame consistency, more
   bandwidth.
3. **Skeletal (Rive / Spine):** fluid, tiny runtime, one rig reusable across
   pets. Best quality + smallest bandwidth, but it's real animation *authoring*
   work (animator or a lot of hand-fiddling). Reserve for hero/legendary pets.

## Steer AWAY from

**Full 3D (Three.js) with AI-generated rigged pet models.** Sounds coolest, but
the rigged-animated-3D-creature pipeline doesn't exist — you'd hand-clean meshes
and rig by hand. 3D models are heavy (MBs each), fighting the project's
bandwidth-cost strategy. HD-2D gets ~90% of the wow at ~20% of the risk/cost.

## Recommended first step (prototype, zero new deps or spend)

1. Add `pixi.js` + `@pixi/react` to `shinobij.client`.
2. New component in its OWN module: `src/components/PetColiseum.tsx`
   (NOT in App.tsx — it's a ratcheted monolith).
3. Generate one coliseum background via `gen-asset.mjs`.
4. One matchup: positioned pet sprites, **procedural** movement + lunge/recoil +
   `fx/` elemental VFX + camera shake, **driven by the real event queue**.
5. Wire it behind a flag / opt-in mode in `PetArena` so the current battle keeps
   working until the new scene is ready.

This proves the direction before any token or art spend.

## What to ADD (only once past the procedural prototype)

- A **fal.ai OR Replicate API token** for AI-animated pet frames (image-to-video).
  Put it in `shinobij.client/.env` alongside `OPENAI_API_KEY`. fal = faster/cheaper,
  Replicate = wider model selection. The prototype needs **nothing** new.

## Repo facts the new session must know

- **Stack:** React 19 + Vite + TS client; Express server (`api/**` handlers).
- **Deploy:** push `HEAD:main`. cPanel serves committed `dist/` verbatim → after
  client changes, rebuild client dist and **force-add** it
  (`git add -Af shinobij.client/dist` — dist is gitignored so new hashed chunks
  are invisible to a plain add), commit src+dist together, push. Railway
  self-builds. Verify a deploy by fetching a committed-dist asset hash from prod
  (e.g. `https://shinobijourney.com/assets/<name>-<hash>.webp` → 200).
- **`main` can move under you** (another session/admin pushes). Re-`git fetch`
  before pushing; on non-fast-forward DO NOT force-push — back up your commit to a
  branch, `git reset --hard origin/main`, re-apply your non-overlapping source via
  `git checkout backup -- <paths>`, rebuild dist, recommit, push.
- **App.tsx** is a drained monolith with a line-budget ratchet test
  (`src/App.size.test.ts`). New code goes in its own module under
  `src/{components,screens,lib}/`, never App.tsx.
- **Cost-sensitive project:** never base64 art into polled game-state; keep
  bandwidth low (the reason 2D > heavy 3D here).
- **Determinism:** the pet battle choreography is server-cross-checked. The new
  visual layer is cosmetic ONLY — it consumes the event queue, never produces
  outcomes.
- Always run lint (`npm run lint` in `shinobij.client`) + `tsc -b` before done.
- The asset-gen pipeline is live: `scripts/gen-asset.mjs` (npm `gen:asset`),
  flags `--transparent` and `--gen-quality low|medium|high`; `OPENAI_API_KEY` is
  set in `shinobij.client/.env`. See the `project-asset-generation` memory.

## Open decisions to confirm with the user at session start

1. **Pixi (flat-2D, recommended) vs react-three-fiber** (true 3D camera / HD-2D).
2. **Procedural-first prototype** (no cost) vs set up the AI-animation token path
   immediately.
3. **Scope:** all pets, or hero/legendary pets first.

## Suggested orientation reads for the new session

1. `src/lib/pet-battle-anim.ts` — esp. `petBattleChoreograph` (document the event
   shape — it's the driver contract) + the `petsheet`/`petlayers`/`petbody` key
   helpers.
2. `src/components/PetBattleAvatar.tsx` — current render + the dimensional slots.
3. `src/screens/PetArena.tsx` + `src/screens/Arena.tsx` — the battle render loop
   and how the choreograph queue is currently consumed/animated.
4. `src/constants/pet-arena.ts` — arena grid layouts.
5. `ls src/assets/fx/` — the elemental VFX frame library to reuse.
