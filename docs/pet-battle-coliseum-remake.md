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

## Open decisions — RESOLVED 2026-06-10 (see "LOCKED PLAN" below)

1. **Renderer → react-three-fiber (HD-2D)**, not flat Pixi. The user's reference
   (Pokémon Legends: Z-A real-time battle) is a true-3D-camera-over-a-receding-
   ground look; r3f gives a real 3D floor + angled camera with the pets as 2D
   billboard sprites — which matches it far better than flat 2D.
2. **Procedural-first** (no cost). AI-animation token path is a later, gated step.
3. **Scope → one-matchup prototype first**, behind an opt-in flag; current battle
   untouched until proven.

## Suggested orientation reads for the new session

1. `src/lib/pet-battle-anim.ts` — esp. `petBattleChoreograph` (document the event
   shape — it's the driver contract) + the `petsheet`/`petlayers`/`petbody` key
   helpers.
2. `src/components/PetBattleAvatar.tsx` — current render + the dimensional slots.
3. `src/screens/PetArena.tsx` + `src/screens/Arena.tsx` — the battle render loop
   and how the choreograph queue is currently consumed/animated.
4. `src/constants/pet-arena.ts` — arena grid layouts.
5. `ls src/assets/fx/` — the elemental VFX frame library to reuse.

---

# ✅ LOCKED PLAN — HD-2D Coliseum (decided 2026-06-10)

## Visual target (locked, with reference)

The user's reference is **Pokémon Legends: Z-A** real-time battle (screenshot
provided): two elemental creatures on a 3D ground viewed at a ~3/4 angled,
slightly-elevated camera; grounded with contact shadows; one mid-cast with the
move's elemental VFX **swirling around the caster**; floating world-space
nameplate + HP bar over each creature; a top-right **"X used Y!"** toast; a
bottom-left active-pet card. **Remove from that reference:** the trainer avatar
and the move-command UI — it is a **spectator AUTO-battle** (creatures pick their
own moves), which our sim already is.

Setting = a **coliseum / battleground arena** (sand/stone floor, curved wall +
crowd backdrop), not Z-A's city street.

**Honest ceiling:** Z-A uses fully-rigged 3D creature models. We have ONE flat
front-facing portrait per pet, and the cost strategy rules out heavy 3D. So pets
are **2D billboard sprites on a 3D stage (HD-2D / Paper-Mario)**, animated
**procedurally**. That reproduces the staging/camera/VFX/UI/feel (~90%); the
creatures themselves read as animated standees, not 3D models. Closing that last
gap = per-pet animation assets later (the asset ladder above), gated on user spend.

## Verified state of the code (2026-06-10 — corrects the older notes above)

- The deterministic ENGINE is already extracted: **`runPetArenaBattle` lives in
  `src/lib/pet-battle-sim.ts`** (~2.6k lines), produces `PetArenaFrame[]`. KEEP AS-IS.
- The per-frame cosmetic DRIVER is **`buildPetAnimationEvents`** in
  `src/lib/pet-battle-anim.ts` (the doc's old name "petBattleChoreograph" is
  stale). Contract: `PetFrameLike` → ordered `PetBattleAnimationEvent[]`. REUSE AS-IS.
- The current DOM/CSS renderer is **`PetArenaBattlefield` in `src/App.tsx`**
  (~line 9403). The new scene REPLACES this one component.
- The playback LOOP lives in **`src/screens/PetArena.tsx`**: it steps `frameIndex`
  through `battleFrames` at `petFramePace(frame)` and passes the *current frame*
  to `PetArenaBattlefield`. This loop is UNCHANGED.
- VFX = **251 CC0 frames** in `src/assets/fx/<key>/NNN.png`, already loaded as
  bundled URL strings via `import.meta.glob` in `src/lib/jutsu-fx-assets.ts`
  (key→frame[] map). Reuse these as r3f billboard frame-swap sprites.
- App.tsx is now ~10.4k lines with the `App.size.test.ts` ratchet (budget 10,500).

## The integration seam (the whole reason this is low-risk)

`PetColiseum` is a **drop-in replacement for `PetArenaBattlefield`** — the SAME
props: `{ playerPet, enemyPet, enemyOwner, playerReservePet?, enemyReservePet?,
frame?, recentFrames?, result, obstacles?, tiles?, onReplay, onFightAgain,
onExit, sharedImages, playerRecord?, enemyRecord? }`. A flag in `PetArena.tsx`
chooses which renderer mounts. Engine, frame-stepping, result handling, and the
`buildPetAnimationEvents` queue are all reused untouched.

## Non-negotiable guardrails (from CLAUDE.md + project memories)

- **Engine untouched.** Never edit `runPetArenaBattle` / `buildPetAnimationEvents`
  / damage math for visuals. The scene is cosmetic-only; it can't affect outcomes,
  balance, odds, or ranked-replay determinism.
- **New code in its OWN modules** (`components/PetColiseum.tsx`,
  `lib/pet-coliseum-*.ts`) — NEVER App.tsx (the ratchet test).
- **`three`/r3f are CLIENT deps** → bundled into client `dist` by Vite; the
  Express server never `require`s them. So the cPanel "auto-deploy doesn't npm
  install" crash risk (which bit the server-side `compression` dep) does **NOT**
  apply here — only the committed client dist matters for cPanel.
- **Lazy-load the 3D scene** (`React.lazy` + dynamic import) so the three/r3f
  bundle loads only when a battle starts → cold-landing stays light
  (bandwidth-cost strategy; never regress the landing payload).
- **Coliseum art via `scripts/gen-asset.mjs`** (`npm run gen:asset`) → published
  as `shared:img:*`, served via `/api/img`. NEVER base64 art into polled
  game-state.
- **Verify in the dev-only `/petvfx.html` harness FIRST** (`src/petvfx.tsx`),
  before touching the live battle. Run `npm run lint` + `tsc -b` before done. For
  cPanel: stop the dev server, rebuild client dist, `git add -Af
  shinobij.client/dist`, commit src+dist together, push `HEAD:main`.

## Build phases

### Phase 0 — Spike / de-risk (½–1 day)
- Add `three`, `@react-three/fiber`, `@react-three/drei` to **`shinobij.client`**.
  Confirm it builds under Vite 8 + React 19 + TS 6 and measure the gzipped bundle
  delta (note it — this is the one real cost). Set up the dynamic import so the
  3D chunk is split out.
- Throwaway scene in `/petvfx.html`: a `<Canvas>` with an angled fixed camera, a
  ground plane, and TWO billboarded planes textured with real pet portraits,
  grounded with blob shadows, always facing the camera. Confirm the HD-2D look
  reads right. **Gate before continuing:** does it feel like the reference?

### Phase 1 — Static coliseum stage (no motion)
- Generate coliseum assets via `gen-asset.mjs`: a floor texture (sand/stone) and
  a backdrop (curved wall + crowd). Publish as e.g. `coliseum:floor`,
  `coliseum:bg` shared images.
- New `src/components/PetColiseum.tsx` (own module). Same props as
  `PetArenaBattlefield`. Renders: lazy `<Canvas>`, angled camera, floor + backdrop,
  pets as billboards at fixed face-off positions (player front-left, enemy
  back-right; 2v2 places all four), contact shadows. Floating nameplates (Lv /
  name / HP) + the bottom-left pet card + top-right toast can stay **DOM overlays**
  on top of the canvas (reuse existing markup) — they don't need to be in 3D.
- Pure helper `lib/pet-coliseum-scene.ts`: `tileToWorld(tileIdx)` mapping the
  sim's grid index → 3D world coords (analogous to the DOM tile centres), so pet
  positions still come from the sim. Colocated `*.test.ts`.

### Phase 2 — Procedural motion driven by the event queue (the core)
- Consume `frame` → `buildPetAnimationEvents` (REUSE) → drive billboard transforms
  over time. Map each `PetBattleAnimationEventType` → a 3D motion in
  `lib/pet-coliseum-scene.ts` (pure: `(eventType, t)` → transform):
  idle = bob/breathe; windup = lean-back + anticipation scale; lunge = dash toward
  target in world space + return; rangedCast/beam = plant + lean; projectile = an
  fx billboard flying caster→target on an arc; impact = target flash + knockback +
  camera shake + fx impact sprite at target; recoil/hit = shove-back + tint;
  charge = caster glow + camera push-in/dim (signature); guard = brace + shield fx;
  dodge = sidestep/blur; ko = topple + fade; victory = winner bob.
- Elemental VFX: small r3f `<FxSprite>` that frame-swaps an fx key's URL[] (from
  `jutsu-fx-assets`) on a billboard plane. Swirl-around-caster (Water-Gun look) =
  fx sprite parented to the caster; projectile = tweened caster→target; impact =
  fx sprite at target. `vfxKey` already flows through every event.
- Camera: reuse the deterministic `petBattleCamera` director (`lib/pet-battle-
  camera.ts`) for hit-stop + shake; add a parallel numeric output (or a
  class→camera-offset map) so r3f can apply it. Floating damage/heal/shield
  numbers rise+fade as billboards. Honor `prefers-reduced-motion`.

### Phase 3 — Wire behind an opt-in flag in `PetArena.tsx`
- A "Cinematic (beta)" toggle / `localStorage` flag picks `<PetColiseum/>` vs the
  current `<PetArenaBattlefield/>`. The playback loop + props are identical.
- **Refactor note:** the per-frame SFX effect currently lives INSIDE
  `PetArenaBattlefield`. Extract it to a shared `usePetBattleFrameSfx(frame, muted)`
  hook (or lift into `PetArena.tsx`) so both renderers get sound without dupe.
- Keep the old renderer as DEFAULT until the new one is proven; flip later.

### Phase 4 — Coliseum polish
- Crowd ambiance (static crowd texture w/ subtle parallax), torches/banners, dust
  kick-up on lunges (fx/earth or a puff), announcer cut-in on signatures (reuse
  the existing announcer), floor decals. Mobile: clamp dpr, responsive resize,
  fill the viewport (verify at the user's REAL innerWidth×height×dpr), graceful
  degrade (circle-portrait textures work as billboards).

### Phase 5 — Asset ladder (LATER, gated on user spend)
- Only if the user wants the creatures themselves to animate beyond procedural:
  add a fal.ai/Replicate token, bake per-pet sprite-sheets (image-to-video →
  frames) into the wired `petsheet:<id>` slot → the billboard plays the sheet as
  an AnimatedSprite. Spine rigs reserved for hero/legendary pets.

## Suggested module layout

- `src/components/PetColiseum.tsx` — the r3f scene (drop-in for PetArenaBattlefield).
- `src/lib/pet-coliseum-scene.ts` (+ `.test.ts`) — PURE helpers: `tileToWorld`,
  event→motion mapping, camera→r3f transform. Node-testable, no r3f imports.
- Reuse: `lib/pet-battle-anim.ts` (driver), `lib/pet-battle-camera.ts` (camera),
  `lib/jutsu-fx-assets.ts` (fx frames), `lib/pet-battle-sim.ts` (engine).
