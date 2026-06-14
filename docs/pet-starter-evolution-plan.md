# Starter Pet Evolution + Digivolution-Style Cutscene — Full Plan

_Last updated 2026-06-13._

> **PHASES 1 & 2 SHIPPED (working tree, uncommitted, tests green — 753 pass; my
> files typecheck clean; client lint 0 errors).**
>
> **Phase 1 — server-authoritative engine:** `api/pet/_evolution.ts` (spec + pure
> `evolvePet`/`checkEvolve`), `api/pet/evolve.ts` (`POST /api/pet/evolve`,
> registered in server.ts, `withKvLock` failClosed, consumes 1 stone, sealed
> stats), `Pet.evolutionStage`/`Pet.wildSpawnable`, `isWildSpawnable()` wired into
> `rollPetEncounter`, `src/data/pet-evolutions.ts` (10 wild-locked
> `STARTER_EVOLUTIONS` + client mirror). Tests: `api/pet/_evolution.test.ts`,
> `src/data/pet-evolutions.test.ts`.
>
> **Phase 2 — player-facing loop:** the two Fate-Shard stones in
> `starter-items.ts` (Awakening 150 / Ascension 400, auto-listed in the Grand
> Marketplace); the **PetYard "✨ Evolution" panel** (requirements + server call +
> local sync); the AdminPanel **"🔒 STARTERS & EVOLUTIONS — never wild"** optgroup
> (locked pets pulled out of the wild rarity groups); and `STARTER_EVOLUTIONS`
> seeded into `petPool` net-zero (App.tsx held at 10,474/10,475).
>
> **Phase 3 — cutscene + art plumbing (SHIPPED working tree, 760 tests green, my
> files typecheck clean, lint 0 errors):** the pure deterministic timeline
> `src/lib/pet-evolution-cutscene.ts` (+ test); the **CSS/3D-transform** cutscene
> `src/components/PetEvolutionCutscene.tsx` (charge → ascend → tube of light +
> silhouette morph → white burst → new-name slam → 360° hero spin → settle;
> skippable; honors prefers-reduced-motion) — built in CSS, NOT r3f, because
> without `.glb` models a turntable is a flat card-spin either way, so this
> compiles + ships today with zero new deps; the `petEvolveCutscene.v1` flag
> (default ON); PetYard plays it on evolve success (else an inline toast); the
> **`visualId` art plumbing** in `pet-battle-anim.ts` (stage art `petbody:
> starter-fire-r` first, base art fallback — no regression) (+ test); and the art
> script `scripts/gen-pet-3d.mjs` (fal Hunyuan3D image→`.glb`).
>
> **STILL NOT done — the ART itself:** poses / portraits / `.glb` models for the
> 10 evolved forms are NOT generated (needs `FAL_KEY` + spend — run gen-asset /
> gen-pet-anim / gen-pet-3d / finalize-pet-poses). Until then evolved pets and the
> cutscene use the BASE art (the light show + name reveals still land; the "new
> form" looks like the base form). A true volumetric `.glb` turntable (r3f + Bloom)
> can replace the CSS card-spin once models exist — the contract won't change.
> **No visual QA** (this sandbox can't build the app — missing
> three/r3f/socket.io/compression; Railway self-builds). Minor cosmetic: the
> AdminPanel rarity-count summary still tallies locked pets. Before any cPanel
> deploy, rebuild + commit `dist/`.

A foolproof, end-to-end plan for evolving the 5 starter pets twice each, with a
Digimon-style cinematic evolution cutscene (name → tube of light → new name →
360° hero turntable). Covers the mechanic, the server authority, the cutscene,
**all the art the pet arenas need**, the UI, fallbacks, build phases, tests, and
cost.

---

## 0. Confirmed decisions

| Decision | Value |
|---|---|
| Pets that evolve | The 5 starters only (`starter-fire/water/wind/lightning/earth`) |
| Evolutions | Twice each: **Standard → Rare** (Lv 50), **Rare → Legendary** (Lv 90) |
| Currency | **Fate Shards** (`fateShards`) — there is no "Fate Stones" in code; Fate Shards is the existing premium pet currency |
| Items | **Two universal stones**: **Awakening Stone** (1st evo), **Ascension Stone** (2nd evo) |
| Item prices (proposed, tunable) | Awakening Stone **150** Fate Shards · Ascension Stone **400** Fate Shards |
| Cutscene | Digivolution-style: old name → tube of light + silhouette morph → burst → new name → **full 360° turntable of the new form's 3D model** |

---

## 1. Codebase reality check (verified against origin repo)

**Pets are 2D sprites composited in 3D (HD-2D) — there are ZERO real 3D models.**
`grep` for `useGLTF` / `gltf` / `glb` / `GLTFLoader` returns nothing. Every pet
in the coliseum is a Y-locked **billboard** (`<Billboard lockX lockZ>` +
`<planeGeometry>`) with a texture. This is the single most important fact for the
cutscene: a "full circle in its 3D form" needs either (a) a **real `.glb` model**
generated from the pet art, or (b) a faux-3D **turntable sprite** flipbook. We
will do (a) with a clean (b) fallback. See §4.

**3D stack is modern and capable.** `shinobij.client/package.json`:
`@react-three/fiber ^9.6.1`, `@react-three/drei ^10.7.7`,
`@react-three/postprocessing ^3.0.4`, `three ^0.184.0`. drei ships `useGLTF`,
`useTexture`, `Billboard`, `Float`; postprocessing ships `EffectComposer` +
`Bloom`. Everything the cutscene needs is already installed — **no new runtime
deps**.

**The fal pipeline can already make 3D.** The project authenticates to fal via
`FAL_KEY` (used by `scripts/gen-pet-anim.mjs`, `gen-pet-run.mjs`). fal hosts
**Hunyuan3D image-to-3D** (`fal-ai/hunyuan3d/v2`, GLB output, ~$0.16 white mesh /
~$0.48 textured). So we can turn each evolved pet's hero art into a real
rotatable `.glb` for a few dollars total, with the existing key.

**Key files (origin repo):**

| Concern | File |
|---|---|
| Starter pet data | [shinobij.client/src/data/starter-pets.ts](../shinobij.client/src/data/starter-pets.ts) |
| Pet rarity tiers + stat base/caps | [shinobij.client/src/data/pet-stats.ts](../shinobij.client/src/data/pet-stats.ts) |
| Pet type / save shape | [shinobij.client/src/types/pet.ts](../shinobij.client/src/types/pet.ts) |
| Pet level / XP curve | [shinobij.client/src/lib/pet-balance.ts](../shinobij.client/src/lib/pet-balance.ts) |
| Fate Shards (currency field) | [shinobij.client/src/types/character.ts](../shinobij.client/src/types/character.ts) · [shinobij.client/src/lib/currency.ts](../shinobij.client/src/lib/currency.ts) |
| Items / inventory | [shinobij.client/src/data/starter-items.ts](../shinobij.client/src/data/starter-items.ts) |
| Marketplace (collars/gear with `cost`) | [shinobij.client/src/data/pet-config.ts](../shinobij.client/src/data/pet-config.ts) |
| Pet screen (Evolve button goes here) | [shinobij.client/src/screens/PetYard.tsx](../shinobij.client/src/screens/PetYard.tsx) |
| Coliseum renderer (r3f, billboards, bloom) | [shinobij.client/src/components/PetColiseum.tsx](../shinobij.client/src/components/PetColiseum.tsx) |
| Sprite/pose resolution + image namespaces | [shinobij.client/src/lib/pet-battle-anim.ts](../shinobij.client/src/lib/pet-battle-anim.ts) |
| Beat choreography (deterministic) | [shinobij.client/src/lib/pet-coliseum-scene.ts](../shinobij.client/src/lib/pet-coliseum-scene.ts) |
| Pose flipbook manifest | [shinobij.client/src/assets/coliseum/pet-poses-manifest.ts](../shinobij.client/src/assets/coliseum/pet-poses-manifest.ts) |
| Pose webp files | `shinobij.client/public/pet-poses/<id>-<cat>.webp` |
| Feature flags (`petColiseum.v1`, `petDuel.v1`, `petBloom.v1`) | `shinobij.client/src/components/pet-coliseum-flag.ts` |
| Asset gen scripts | `shinobij.client/scripts/{gen-asset,gen-pet-anim,slice-pet-poses,gen-pet-run,gen-all-pet-poses,finalize-pet-poses,gen-bg}.mjs` |
| Server (route registration) | [server.ts](../server.ts) · handlers under [api/pet/](../api/pet) |

**Reachability of the gates.** `petXpNeeded(level) = level × 100`, `maxLevel: 100`
for all pets, so Lv 50 and Lv 90 are reachable. Lv 50 **already** flips
`unlockedForPve` — the first evolution lands on an existing milestone beat.

---

## 2. The 5 evolution lines (proposed names)

The pet's persistent **`id` never changes** across stages (see §3 for why this is
load-bearing). Only `name`, `rarity`, stats, and art change.

| Element | Standard (start) | Rare — Lv 50 + Awakening Stone | Legendary — Lv 90 + Ascension Stone |
|---|---|---|---|
| 🔥 Fire (`starter-fire`) | Cinder Cub | **Ember Wolf** | **Inferno Fenrir** |
| 💧 Water (`starter-water`) | Ripple Seal | **Tidal Selkie** | **Abyssal Leviathan** |
| 🌪 Wind (`starter-wind`) | Gale Chick | **Storm Hawk** | **Tempest Roc** |
| ⚡ Lightning (`starter-lightning`) | Spark Pup | **Bolt Fang** | **Raijin Hound** |
| 🪨 Earth (`starter-earth`) | Pebble Tortoise | **Granite Tortoise** | **Mountain Genbu** |

---

## 3. Mechanic — data model, gating, stats, server authority

### 3.1 The two universal items

Add to [starter-items.ts](../shinobij.client/src/data/starter-items.ts) as
stackable consumables, and list them in the Grand Marketplace pet shop
([pet-config.ts](../shinobij.client/src/data/pet-config.ts)) with a `cost` in
Fate Shards (same flow collars/gear already use):

| Item id | Name | Tier | Lv gate | Cost |
|---|---|---|---|---|
| `evo-stone-awakening` | Awakening Stone | Standard→Rare | 50 | 150 Fate Shards |
| `evo-stone-ascension` | Ascension Stone | Rare→Legendary | 90 | 400 Fate Shards |

The full cost lives in the **stone's purchase price**; evolution itself just
consumes one stone of the correct tier. (Price rationale: collars 50–300, PvP
gear 100–150, nickname 10 — 150 sits mid-gear, 400 above the top collar to mark a
legendary milestone. All tunable, no existing price touched.)

### 3.2 Pet save-shape touches

On the `Pet` type ([pet.ts](../shinobij.client/src/types/pet.ts)):

- **Add** `evolutionStage?: 0 | 1 | 2` (0 = standard/base, 1 = rare, 2 =
  legendary). Defaults to 0 for existing saves. Used to gate re-evolution and to
  pick stage art. Stage is also inferable from `rarity` for starters, but the
  explicit field is a cheap, unambiguous guard.
- **Reuse** existing fields, rewritten on evolve: `name`, `rarity`,
  `hp/attack/defense/speed`, `moveRange` (legendary only), `image`, `bodyImage`.
- **Preserve untouched:** `id`, `element`, `level`, `xp`, `happiness`, `loadout`,
  active `training`/`expedition`, `jutsus`.

### 3.3 The `visualId` rule (handles stage-specific art without changing `id`)

**Problem:** pose flipbooks and shared images are keyed by pet **id**. If `id`
stays `starter-fire` across all 3 stages, a naïve lookup returns the *standard*
art forever.

**Solution:** introduce a derived **visual id** used only for art lookups:

```
stage 0 → starter-fire        (existing art, unchanged)
stage 1 → starter-fire-r      (rare art)
stage 2 → starter-fire-l      (legendary art)
```

- Add a `petVisualId(pet)` helper in
  [pet-battle-anim.ts](../shinobij.client/src/lib/pet-battle-anim.ts) and thread
  it through `usePetPoses` / sprite resolution so poses, `petbody:`, `pet:`,
  `petsheet:` all resolve by `visualId`, not raw `id`.
- On evolve, the server also rewrites `pet.image`/`pet.bodyImage` to the stage
  URLs, so menus/roster (which read those fields directly) show the new form
  immediately, even before the coliseum manifest is consulted.

**Why keep `id` stable:** `builtInPetTemplateId()` never matches `starter-*`, so
`normalizePet()` leaves evolved starters alone — the new rarity/stats/stage will
**not** be reverted on reload (the same exclusion that protects their hand-authored
kits today). Changing the id risks orphaning loadout / training-token /
expedition references keyed off it. `capPetStats` clamps by `rarity`, so the
higher caps unlock automatically the moment rarity changes (a plus, not a bug).
Carrying `element` forward means the rename can't break element-typed lookups.

### 3.4 Stat math (one-time bump = the gap between tier base templates)

Applied **on top of** current stats (preserves each pet's role lean), making an
evolved pet equivalent to a native pet of that rarity. Deltas derived from
[pet-stats.ts](../shinobij.client/src/data/pet-stats.ts) base tables:

| Evolution | +HP | +ATK | +DEF | +SPD | +Move range |
|---|---|---|---|---|---|
| Standard → Rare | +50 | +8 | +6 | +6 | — |
| Rare → Legendary | +46 | +6 | +4 | +5 | +1 (3→4) |

New caps unlock automatically via the new `rarity` (HP 1700→1900→2140, ATK
260→290→326, DEF 210→240→270, SPD 190→220→247).

_Kit/jutsu changes are intentionally **excluded** from the base plan (balance-
sensitive). Optional extension: each evolution upgrades the signature move —
needs explicit sign-off._

### 3.5 Server authority (load-bearing — CLAUDE.md hard rule)

Evolution spends currency + consumes an item + upgrades a pet, so it **must** be
server-authoritative. **Sequencing: the server mutation completes atomically
FIRST; the cutscene is a pure celebration that plays afterward.** If the player
closes the tab mid-cutscene, the evolution is already saved — no desync, no cheat
surface.

- **New endpoint** `POST /api/pet/evolve` in [api/pet/](../api/pet) — and it
  **must be `route()`-registered in [server.ts](../server.ts)** on both the bare
  and `/api`-prefixed paths (no auto-routing; an unregistered handler is
  unreachable on Railway and cPanel).
- **Validates:** token-first auth; pet exists on this player's save; pet is a
  `starter-*` line; `evolutionStage`/`rarity` is the expected pre-tier;
  `level ≥ gate` (50 or 90); the required stone is in `inventory`.
- **Mutates atomically** inside `withKvLock(saveKey, { failClosed: true })`
  (currency/inventory path): remove one stone, set new
  `rarity`/`name`/`evolutionStage`/stats/`image`/`bodyImage` from **sealed
  server-side values** (never the client body), save. Returns the evolved pet.
- **Marketplace purchase** of the stones is likewise server-authoritative (the
  existing pet-shop spend path — deduct `fateShards`, push item id to
  `inventory`).
- **Offline:** the Evolve button requires the server; disable it when offline.

### 3.6 Wild-spawn lockout + admin "Locked Pets" section

**Requirement:** evolved forms must **never** appear in the wild / explore-tile
encounters, and must live in the **admin panel** under a section that is locked
out of wild spawning (so admins can name/image/edit them — exactly the reason the
5 base starters are already in the pool).

**This is the same pattern the starters already use.** The 5 `starter-*` pets sit
in `petPool` *only* so the admin Pet Editor can image them; they're kept out of
wild encounters by an id-prefix filter in `rollPetEncounter()`
([pet-balance.ts](../shinobij.client/src/lib/pet-balance.ts):683):
`pets.filter(p => p.rarity === fallbackRarity && !p.id.startsWith("starter-"))`.
**Critical gotcha:** `editablePets` (the admin-editable list) *is* the live wild
encounter pool — `WorldMap.tsx` calls `rollPetEncounter(editablePets)`, and
`mergeMissingBuiltInPets()` seeds every built-in template into it. So anything we
add to the pool spawns in the wild **unless explicitly excluded**.

**Design (belt-and-suspenders):**

1. **Evolved templates use the `visualId` ids** from §3.3 — `starter-fire-r`,
   `starter-fire-l`, etc. Because they start with `starter-`, the **existing**
   wild filter already excludes them with zero new logic. (They also don't match
   `${rarity}-${index}`, so `balanceBuiltInPetTemplate`/`normalizePet` leave them
   untouched, like the base starters.)
2. **Add an explicit, self-documenting flag** rather than relying only on a string
   prefix: add `wildSpawnable?: boolean` to the `Pet` type
   ([pet.ts](../shinobij.client/src/types/pet.ts)). Introduce a shared helper
   `isWildSpawnable(pet)` = `pet.wildSpawnable !== false && !pet.id.startsWith("starter-")`
   and switch `rollPetEncounter()` to use it. Mark all 5 base starters **and** all
   10 evolved templates `wildSpawnable: false`. This also future-proofs event/
   admin-only pets.
3. **Seed the 10 evolved templates into the pool like the starters** — a new
   `STARTER_EVOLUTIONS` export in `src/data/pet-evolutions.ts`, appended to
   `petPool` next to `STARTER_PETS` in `App.tsx` (unbalanced, flagged
   `wildSpawnable: false`). They serve double duty: the **art source**
   (`pet:starter-fire-r` / `petbody:starter-fire-r`, hydrated for all players) and
   the **admin-editable** entries. They are pool/template entries only — players
   never *own* them except by evolving their starter, so this grants no free pets
   (same as starters today).
4. **Admin panel — new "Locked Pets" section.** In the Pet Editor
   ([AdminPanel.tsx](../shinobij.client/src/screens/AdminPanel.tsx):3648–3943,
   currently grouped only by rarity), add a clearly-labeled group:
   **"🔒 Locked — Starters & Evolutions (never spawn in the wild)"** that lists
   every pet with `wildSpawnable === false` (the 5 starters + 10 evolutions).
   Selecting one opens the normal edit form (name / stats / image); editing its
   image publishes the stage art for all players. Gated behind the existing admin
   login (`x-admin-password`). This is the section the requirement asks for, and it
   makes the lock visible so no one accidentally drops an evolution into the wild
   pool.

**Net effect:** evolved forms are unreachable from explore-tile encounters via
*two* independent guards (the `wildSpawnable:false` flag and the `starter-` id
prefix), while remaining fully editable in their own admin section.

### 3.7 Lineage & element rules ("make the evolutions make sense + keep element")

- **Same element, carried inline.** Each evolved template sets the same
  `element` as its base (`starter-fire-r`/`-l` → `"Fire"`, etc.). Element
  resolution prefers the pet's own `element` field over the name-keyed
  `pet-elements.ts` table, so keeping `element` inline **just works** — no entry
  in `petElementByName` is required (though we may add the new names there too for
  consistency). Element is also explicitly *preserved* by the evolve endpoint
  (§3.2), so the type-matchup wheel (Fire>Wind>Lightning>Earth>Water>Fire) stays
  intact across all 3 stages.
- **Believable growth, not a new species.** The art for each stage depicts the
  *same creature* matured/empowered with the same elemental palette — e.g.
  Cinder Cub → Ember **Wolf** → Inferno **Fenrir** (a cub growing into a wolf into
  a mythic wolf-beast), Ripple **Seal** → Tidal **Selkie** → Abyssal **Leviathan**
  (Selkie literally being a seal-spirit, preserving the lineage cue). The art
  prompts in §5 must reference the prior stage's silhouette/colors so the line
  reads as one creature evolving. See the name table in §2.

---

## 4. The evolution cutscene (Digimon-style)

### 4.1 Reference — the canonical digivolution beats

From research (see Sources): the classic sequence is the rookie **glowing and
slowly spinning in a black void**, a **name call-out** ("X digivolve to…!"), the
camera **crash-zooming** while the body reads as a **silhouette/wireframe with
data being rewritten** ("skin peeling/reforming"), a **burst of light**, then the
camera **pulling out to reveal the new, larger form**, the **new name slamming
in**, and a **hero pose**. The musical swell (Braveheart-style) is half the
impact. Our beats map 1:1 to the user's ask: _old name → cinematic tube of light
→ new name → full 360° circle of the new 3D form._

### 4.2 New component: `PetEvolutionCutscene.tsx`

A self-contained full-screen overlay (its own `<Canvas>` + `EffectComposer` +
`Bloom`, bloom **forced on locally** regardless of the global `petBloom.v1`
flag — the glow is the whole point). Launched from Pet Yard *after* the
`/api/pet/evolve` success. Deterministic timeline driven by `useFrame` + an
elapsed clock (no RNG). **Skippable** (tap → jump to final hold) and
**reduced-motion aware** (`prefers-reduced-motion` → quick crossfade + name
cards, no spin).

### 4.3 Timeline

| t (s) | Beat | What renders |
|---|---|---|
| 0.0–1.2 | **Charge** | Void/vignette fades in; old-form billboard (its existing `idle` pose) pulses with a rim glow; particles converge inward; old **name** fades in at bottom. Low rumble. |
| 1.2–2.2 | **Ascend & spin** | Old form rises and slowly Y-spins; particle streaks accelerate. (Flat billboard spin is masked by the void + rim-light + streaks.) |
| 2.2–3.4 | **Tube of light** | Camera crash-zoom; a procedural **light tube** (cylinder around the camera, scrolling additive emissive shader, streaks rushing toward lens) engulfs the form; the form switches to a **white emissive silhouette + wireframe ring** (data-rewrite motif). This is the "cinematic tube of light." |
| 3.4–3.8 | **Burst** | Bloom intensity spikes to a white flash; audio sting. |
| 3.8–4.2 | **Reveal** | Flash recedes, camera pulls back; the **`.glb` of the new form** fades in (true 3D). New **name** slams in. |
| 4.2–6.5 | **Full-circle turntable** | The `.glb` does one smooth **360° Y rotation** under a hero key-light + bloom rim, slow ease — "make a full circle in its 3D form." |
| 6.5–end | **Settle** | Model eases to a 3/4 hero angle and holds; "Continue" button; dismiss → back to Pet Yard with the evolved pet (poses now its new form). |

### 4.4 The "3D form" — implementation + fallback (the critical detail)

There are no rigged models today, so:

- **Primary (true 3D):** generate one `.glb` per evolved form from its hero art
  via **fal Hunyuan3D** (§5), store under `public/pet-models/<visualId>.glb`,
  load with drei `useGLTF`, spin it 360°. Real depth, real rotation.
- **Fallback A (faux-3D turntable):** a pre-baked **turntable sprite flipbook**
  (16–24 angle frames from a multi-view gen) played as a rotating flipbook — same
  2D pipeline, no WebGL model load.
- **Fallback B (graceful):** on low-end/mobile/WebGL-context failure or missing
  `.glb`, scale-in the new **full-body billboard** (no true rotation) — still
  shows the new form + name. Never blocks the evolution (which already saved).

Capability check picks Primary on capable devices, Fallback B otherwise; a flag
`petEvolveCutscene.v1` can force the lightweight path globally.

### 4.5 Tube-of-light shader (no new asset needed)

A custom `ShaderMaterial` on a cylinder (camera inside), scrolling UV +
additive blending + transparency for the rushing-light streaks; the existing
`Bloom` pass amplifies it into the glowing tunnel. Procedural ⇒ no backdrop image
dependency. (Optional painted "evolution chamber" backdrop later.)

---

## 5. Art production — "images for the pet arenas"

Each evolved form must be **arena-ready**, i.e. it needs the same art every
roster pet has, plus the cutscene model. **Standard stage art already exists** —
we produce art for the **10 evolved forms** (5 Rare + 5 Legendary).

### 5.1 Per-form art matrix

| Asset | Key / path (by `visualId`, e.g. `starter-fire-r`) | Used in | Tool |
|---|---|---|---|
| Portrait | `pet:<visualId>` → `pet.image` | Pet Yard, roster, menus | `gen-asset.mjs` (OpenAI gpt-image-1) |
| Full-body sprite | `petbody:<visualId>` → `pet.bodyImage` | Coliseum billboard, cutscene reveal/fallback | `gen-asset.mjs` |
| Pose flipbook ×6 | `public/pet-poses/<visualId>-{idle,attack,hurt,cast,run-a,run-b}.webp` | **Pet arena combat** | `gen-pet-anim.mjs` + `slice-pet-poses.mjs` + `gen-pet-run.mjs` → `finalize-pet-poses.mjs` |
| 3D model | `public/pet-models/<visualId>.glb` | Cutscene 360° turntable | **new** `gen-pet-3d.mjs` (fal Hunyuan3D) |

Totals: **10 forms × (1 portrait + 1 body + 6 poses) = 80 webp**, plus **up to 10
`.glb`** (minimum: the 5 Legendary finals).

### 5.2 Pipeline (per form)

```bash
# 1. Hero portrait + full-body (gpt-image-1)
node scripts/gen-asset.mjs --id pet:starter-fire-r     --prompt "<rare ember wolf, front 3/4>"  --gen-quality low
node scripts/gen-asset.mjs --id petbody:starter-fire-r --prompt "<full body, transparent bg>"  --transparent

# 2. 4-pose combat sheet → slice → run cycle  (fal nano-banana)
node scripts/gen-pet-anim.mjs --id starter-fire-r
node scripts/slice-pet-poses.mjs --id starter-fire-r
node scripts/gen-pet-run.mjs --id starter-fire-r

# 3. Real 3D model for the cutscene  (NEW script → fal Hunyuan3D, GLB out)
node scripts/gen-pet-3d.mjs --id starter-fire-r --src asset-gen-out/petbody/starter-fire-r.webp

# 4. After all forms: regenerate the pose manifest to include the new visualIds
node scripts/finalize-pet-poses.mjs
```

`gen-pet-3d.mjs` is a thin new script mirroring `gen-pet-anim.mjs` (reads
`FAL_KEY`), calling `fal-ai/hunyuan3d/v2` (textured) and writing
`public/pet-models/<id>.glb`.

### 5.3 Approximate cost

| Item | Qty | ~Unit | ~Total |
|---|---|---|---|
| Portraits + bodies (gpt-image-1 low) | 20 | $0.02 | $0.40 |
| Pose sheets + run cycles (fal nano-banana) | 10 | ~$0.12 | ~$1.20 |
| GLB models (fal Hunyuan3D, textured) | 10 | $0.48 | $4.80 |
| **Total** | | | **≈ $6.40** (≈ $4 if only 5 legendary `.glb`) |

(For scale: the original full 148-pet pose flipbook cost ~$14.80.)

### 5.4 Asset gotchas (from prior pet-art work)

- Nano-Banana never outputs true alpha → the white-key step in
  `slice-pet-poses` is mandatory (keep it).
- Rebuilding `shinobij.client/dist` re-compresses all PNGs; **stop the dev server
  first**, commit only the `.js/.css/.html` bundle + the new webp/glb, and
  restore unrelated images to committed bytes (avoids image churn).
- New pet art published to shared images uses the admin publish path; the
  `item:`/`pet:` ownership carve-outs already exist.

---

## 6. UI integration

- **Pet Yard** ([PetYard.tsx](../shinobij.client/src/screens/PetYard.tsx)): an
  **Evolve** panel on the selected pet. Shows the next form's silhouette + name,
  the requirements (Lv gate, stone owned?), and a button that is:
  - hidden if the pet isn't a starter or is already Legendary,
  - disabled with a hint otherwise ("Reach Lv 50", "Needs Awakening Stone",
    "Go online to evolve").
  On click → confirm modal → `POST /api/pet/evolve` → on success, mount
  `PetEvolutionCutscene` → on dismiss, refresh the pet.
- **Grand Marketplace**: list the two stones with Fate-Shard prices alongside
  collars/gear.

---

## 7. Flags, fallbacks, performance, accessibility

- **New flag** `petEvolveCutscene.v1` in
  `shinobij.client/src/components/pet-coliseum-flag.ts` (default ON once art
  ships). OFF → evolution still happens server-side; client shows a quick
  "Evolved into X!" toast instead of the cinematic.
- **Bloom** is scoped to the cutscene's own `EffectComposer` (independent of the
  global `petBloom.v1`).
- **Mobile / weak GPU:** capability check drops the `.glb` for the 2D fallback,
  lowers particle counts, caps DPR.
- **`prefers-reduced-motion`:** crossfade + name cards, no spin/zoom.
- **Always skippable**; closing early is safe (evolution already persisted).

---

## 8. Build phases

1. **Mechanic core (server-authoritative).** `evolutionStage` field; evolution
   line data (new module `src/data/pet-evolutions.ts`); the two stone items +
   marketplace listing; `api/pet/evolve.ts` + `server.ts` registration + lock +
   sealed stat math; tests. _Shippable behind no-art (uses placeholder/standard
   art via visualId fallback)._
2. **`visualId` art plumbing.** `petVisualId()` + thread through pose/sprite/
   shared-image resolution so evolved stages can carry their own art.
3. **Pet Yard Evolve UI + marketplace.** Requirement display, confirm, call.
4. **Art production.** Generate the 80 webp + `.glb` (§5); regenerate the pose
   manifest; commit (mind dist image-churn).
5. **Cutscene.** `PetEvolutionCutscene.tsx` (timeline, tube shader, `.glb`
   turntable, fallbacks, reduced-motion, skip).
6. **Polish + balance.** Audio sting, Monte-Carlo check that an evolved starter
   ≈ a native pet of that rarity.

A no-art preview (Phases 1–3 + a stub cutscene using standard art) can ship
first; art (Phase 4) backfills the visuals.

---

## 9. File-by-file change list

**New:**
- `shinobij.client/src/data/pet-evolutions.ts` — per-line stages (names, gate,
  item, stat deltas, visualId art keys) **and** the `STARTER_EVOLUTIONS` pool
  templates (10 forms, each `wildSpawnable: false`, element carried inline).
- `api/pet/evolve.ts` — authoritative evolve endpoint.
- `shinobij.client/src/components/PetEvolutionCutscene.tsx` — r3f cutscene.
- `scripts/gen-pet-3d.mjs` — image→glb via fal Hunyuan3D.
- `public/pet-models/<visualId>.glb` (×5–10); `public/pet-poses/<visualId>-*.webp`
  (×60); portrait/body shared images (×20).
- Tests: `api/pet/evolve.test.ts` (+ a stat-math test).

**Edited:**
- `shinobij.client/src/types/pet.ts` — add `evolutionStage?` **and**
  `wildSpawnable?`.
- `shinobij.client/src/data/starter-items.ts` — two stones.
- `shinobij.client/src/data/pet-config.ts` — marketplace listing.
- `shinobij.client/src/lib/pet-balance.ts` — add `isWildSpawnable()` helper;
  `rollPetEncounter()` filters on it (excludes the 5 starters + 10 evolutions).
- `shinobij.client/src/App.tsx` — append `STARTER_EVOLUTIONS` to `petPool`
  (next to `STARTER_PETS`), unbalanced; ensure `normalizePet` preserves
  `evolutionStage`/`wildSpawnable`.
- `shinobij.client/src/screens/AdminPanel.tsx` — new "🔒 Locked — Starters &
  Evolutions" section in the Pet Editor (lists `wildSpawnable === false` pets,
  editable/imageable).
- `shinobij.client/src/lib/pet-battle-anim.ts` — `petVisualId()` + thread through
  resolution.
- `shinobij.client/src/assets/coliseum/pet-poses-manifest.ts` — regenerated.
- `shinobij.client/src/components/pet-coliseum-flag.ts` — `petEvolveCutscene.v1`.
- `shinobij.client/src/screens/PetYard.tsx` — Evolve panel + launch.
- [server.ts](../server.ts) — register `/api/pet/evolve` (both paths).
- `server-routes.test.ts` — covers the new route automatically (keep green).

---

## 10. Tests & verification

- **Server:** `npm test` (repo root) — `api/pet/evolve.test.ts` for gating
  (wrong tier, under-level, no stone, offline), atomic spend (stone consumed +
  pet upgraded exactly once, lock held), and that stats/rarity come from sealed
  server values; `server-routes.test.ts` stays green.
- **Client:** `npm run lint` inside `shinobij.client/`; manual cutscene check at
  the user's real viewport; reduced-motion + skip + 2D-fallback paths.
- **Deploy:** after any `api/`/`server.ts` change, `npm run build` and commit the
  regenerated **root `dist/` and `shinobij.client/dist/`** (cPanel serves
  committed `dist/` verbatim; Railway self-builds).

---

## 11. Risks & edge cases

- **`editablePets` IS the wild pool** → adding evolved templates to the pool makes
  them wild-spawnable *unless* excluded. Guarded twice: `wildSpawnable:false` flag
  + `starter-` id prefix, both checked in `isWildSpawnable()` (§3.6). A test should
  assert no `wildSpawnable:false` pet can return from `rollPetEncounter()`.
- **Stage art keyed by id** → solved by the `visualId` rule (§3.3); without it,
  evolved pets would show standard art in the arena.
- **Normalizer reverting evolved starters** → cannot happen (`starter-*` excluded
  from `builtInPetTemplateId`), provided `id` stays stable.
- **`.glb` load failure / weak device** → 2D fallback; evolution already saved.
- **Double-spend / race** → `withKvLock(..., { failClosed: true })` + single-use
  stone consumption.
- **Can't skip tiers** → endpoint checks current `evolutionStage`/`rarity`, not
  just level.
- **Save compatibility** → `evolutionStage` optional, defaults 0; no existing pet
  changes.
- **Balance** → deltas equal the native tier gap, so evolved starters don't
  exceed same-rarity pets; mythic stays out of starter reach by design.

---

## Sources (research)

- [Digivolution — DigimonWiki (Fandom)](https://digimon.fandom.com/wiki/Digivolution)
- [Best Digimon Transformation Sequences, Ranked — CBR](https://www.cbr.com/digimon-best-digivolution-sequences/)
- [Digimon Adventure's New Transformation Sequences — Gizmodo](https://gizmodo.com/digimon-adventure-s-new-transformation-sequences-are-go-1844217870)
- [Hunyuan3D Image-to-3D API on fal.ai](https://fal.ai/models/fal-ai/hunyuan3d/v2/api)
- [Best Image-to-3D Tools 2026 — 3DAI Studio](https://www.3daistudio.com/3d-generator-ai-comparison-alternatives-guide/best-image-to-3d-tools-2026)
- [SV3D — Stability AI (single image → multi-view turntable)](https://stability.ai/news/introducing-stable-video-3d)
- [Zero123++ — single image to consistent multi-view](https://github.com/SUDO-AI-3D/zero123plus)
- [Beautiful effects with WebGL Render Targets — Maxime Heckel](https://blog.maximeheckel.com/posts/beautiful-and-mind-bending-effects-with-webgl-render-targets/)
- [Stylized wireframe rendering in WebGL — mattdesl](https://github.com/mattdesl/webgl-wireframes)
