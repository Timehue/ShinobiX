# Make Model: stocky body template handoff (for Codex)

> **Local prototype built.** The fourth template fits the dinosaur portrait and renders in all
> eight directions. The checks with Nero and Rill matched the previous release across all 48 sampled
> idle, walk and run sheets. The worker README documents the candidate archives and the approved
> comparison portraits required for live use. The hosted trial and deployment are pending.

## The problem

Make Model turns a player's portrait into a walking world sprite. Every model is painted onto one of
three **human-proportioned** rig templates and walked by one human rig. That is right for people and for
dressed animals: the armored raccoon on the account `rill` (job `2568e57c…`, published 2026-11-20) looks
good and must not change.

It is wrong for **cartoon and chibi characters**, which are mostly head, with a round body, short stubby
legs and big feet. The account `reptar` (job `c0c4633a…`, 2026-11-22) uploaded a bare cartoon dinosaur
with a huge round head, a big belly and three-toed feet. The rig turned it into a tall person in a
dinosaur suit: small head, long legs, invented boots and scarf, and its hips painted as a flared coat
hem. In game it reads as a green dress on stick legs.

The goal is a **fourth template with stocky proportions**, used only for characters whose portrait
calls for it, so they look like their portrait. Everyone else must render exactly as today.

## What was built just before this (2026-11-21, the worker deploy after v14)

Read these first; build on them rather than beside them.

- `workers/avatar-model/animal_build.py`: one question at paint time for an upright animal: dressed or
  bare. Asked once per job, kept in the job's work folder, any failure means "dressed".
- `workers/avatar-model/paint_portrait.py` `BARE_ANIMAL`: a bare animal is painted in its own skin,
  scales or fur, with its own feet in the boot cutouts and hips instead of a coat hem. Binding flag
  `bareAnimal`; a repair replays its first painting's flags (see `costume_painter`).
- Legs: the movement bundle's `render_fitted_roster.py` narrows every human leg to 78% below the hip
  (`LEG_SLIM`, `slim_painted_leg`). Animals keep their painted legs: `modal_sprite_worker.record_painted_legs`
  writes the `shinobix-avatar-leg-builds` Modal Dict at paint time, `painted_legs()` reads it in each
  style render, and `paint_sprite_style.py --painted-legs` sets `SHINOBIX_LEG_SLIM=1` for the render and
  turn processes. **That Dict-keyed-by-asset-and-fitted-master pattern is how a render learns anything
  about the portrait.** The server never sees it, so no server change is needed for a render-side switch.
- README `workers/avatar-model/README.md` (release archives paragraph) documents all of it.

## How the pipeline is built (the parts this touches)

- **Stages:** portrait screen (`read_portrait`) → `paint_costume` (one Modal call per asset, OpenAI image
  edit onto the template, rig check, up to 3 paintings + one second round) → `render_style` A, B, C in
  parallel on ONE machine (they must produce byte-identical shared walking frames) → `finish_styles`
  (assembly) → `recognize_sprite` → ready. Server: `api/avatar-model/_dispatch.ts`.
- **Templates** live in the intake and motion bundles (zips, NOT in git), under
  `.ci-evidence/avatar-model/portable-fit-worker/` and `portable-motion-worker/` in the main checkout.
  Each template is a guide PNG (8 columns s, se, e, ne, n, nw, w, sw × 5 rows: head+torso, arm0, arm1,
  leg0, leg1) plus JSON: `guideRect`, `virtualBox`, `sourceSize`, `joints`, `sole`, `footSpan`, and a
  `rigConfig` (`hips`, `hip_y`, `shoulders`, `center`, `foot_width`, …). Current:
  `male-coat-template.json`, `female-coat-template.json`, `masked-collar-template.json`.
- **The template is chosen at the portrait screen** and sealed in the screened descriptor
  (`fit.template`, `templateSha256`). `paint_admitted_costume.admitted_rig` only admits those three names.
- **Rig check** (`constrained-fit-study-v2/fit_candidate.py`): limb IoU ≥ 0.70, body ≥ 0.60 against the
  template's cutouts. `register_painted_kit.py` (intake bundle) registers each painted piece to its slot,
  measures torso aspect (`TORSO_ASPECT` 0.6–1.75) and one-sided trailing parts (`trailing_part`, chest
  band only).
- **Render:** `render_fitted_roster.read_parts` loads the parts; the upper body is a 2D painted rig
  (`pilot_sprite_renderer`, `articulated_torso`: the head pitches about the neck point = shoulder
  midpoint, 30 rig units up); the **legs are a Blender pass** whose tube radii are measured from the
  painted leg textures (`geometry`, `prepare_kit_all_views.source_spec`). Planted turns
  (`render_upload_pivots.py`) reuse the same parts. The standing figure is normalised to 73.44 px tall
  (`render_view` neutral calibration: `73.44/(bounds height)`), so a bigger head makes the body smaller.
- **Frame:** every frame must fit a 400 × 480 canvas or the render raises `clipped`
  (`pilot_sprite_renderer.render`). `register_painted_kit.FRAME_REACH = 300` rig units, and the pivot code
  uses fixed offsets (`y-60`).

## What we learned on 2026-11-21 (so you don't repeat it)

1. **A bigger head works on the current rig, but the canvas stops it.** A trial scaled the painted head
   about the neck point in all 8 standing views (`head_trial.py`, below). ×1.16 renders cleanly and reads
   clearly cuter; ×1.25 is refused as `clipped` at the top of the canvas when standing still, before any
   walk or run frame. A stocky template must therefore move the figure down or grow the canvas upward,
   everywhere the 400 × 480 frame and the `y-60` offsets are assumed, and prove no walk, run, start,
   brake, gait-change or turn frame clips.
2. **Tails.** The rig only recognises a trailing part beside the chest (`CHEST_BAND = (.38, .55)`). A
   dinosaur tail hangs at hip height, so it counts as torso width; past `TORSO_ASPECT` the painting is
   refused. That is why `TAIL_FIT` keeps tails short. A stocky template should give the tail its own
   room (a hip-height trailing band, or a tail piece) with its own check.
3. **Boots** come from the template's leg art and the base prompt ("each leg includes its boot"). The
   stocky template's legs should end in big plain feet, not boots.
4. **The invented red scarf** leaked from the world style reference (`sector-costume-light.png`, a person
   in a red scarf) despite `REFERENCE_IDENTITY`. `BARE_ANIMAL` now forbids it for bare animals.

## What to build

1. **A stocky template** in the same format: shorter legs (about 30–35% of standing height instead of
   about 45%), a wider round torso with a belly and a short hip flare, a head about a third of standing
   height, big feet with toes instead of boots, and tail room behind the hips. Guide PNG + JSON for all
   8 views and 5 rows, joints and sole/foot specs that match it.
2. **Rig and motion fit:** the leg joints, `hip_y`, `foot_width`, stride calibration (`metricPixels`) and
   the Blender leg pass must work with short legs: no foot sliding, no knee popping, feet planted in
   walk, run, starts, brakes, gait changes and the planted turns. The cached surface library and lower
   checkpoints are keyed by geometry, so they will miss and recompute; expect slower renders, measure it.
3. **Canvas headroom** for the big head (finding 1), with every frame type proven unclipped.
4. **Routing:** decide at the portrait screen or at paint time which characters get the stocky
   template. Suggested signal: extend `animal_build.py` (or the upright screen) with a strict question
   such as "head at least a third of standing height, short legs, cartoon proportions". Keep "dressed
   animals and people go to the current templates" as the default, and any failure falls back to them.
   If the template is chosen at paint time rather than at the screen, the sealed `fit.template` and
   `admitted_rig` need a reviewed change: talk to the owner before touching the server or the descriptor.
5. **Prompts:** a stocky painting prompt (big head, belly, own feet, tail room). Every new prompt line
   gets its own binding flag, and a repair must replay its first painting's exact prompt (see the
   `tailFit` and `referenceIdentity` examples in `costume_painter`).
6. **Bundles:** repack the intake and motion zips the way the README describes (copy every entry byte for
   byte, swap the changed files, update the index hash in `motion-worker.json` / `intake.json`; the
   intake also recomputes `paintingRevision`). Keep each edited file next to its archive with the
   archive's name as a prefix. Pin the new hashes in `workers/avatar-model/sprite-worker-painted-review.json`
   and write a `.ci-evidence/deploy-modal-worker-*.ps1` like the existing ones.

## How to prove it (all of these, before asking to deploy)

- **Humans and dressed animals unchanged, byte for byte.** Render Nero's painting (human), Rill's
  (dressed raccoon) and Hazelnyan's (cat girl) with the new bundles and compare against the current
  bundles. Their legs, frames and the receipts' hashes must not move.
- **A stocky render of Reptar** from his portrait, all 8 facings, at game size (81 px tall, 4× nearest),
  next to his current model. Send it to the owner.
- **Every frame type renders** (Blender pass included) on Modal with no `clipped` error, using
  `modal_portrait_trial.py submit <portrait> <dir>` (it runs a portrait without a game slot; it costs
  OpenAI and Modal money, so run it a handful of times, not a sweep).
- `python -m unittest discover -s tests -p "test_*.py"` in `workers/avatar-model` (CI only runs files
  named `test_paint_*.py`, `test_recognition_*.py` and the other patterns in `.github/workflows/ci.yml`:
  name new test files to match).

Local recipe without Blender (it renders the standing upper body and painted legs):

1. Extract the motion zip to a folder.
2. Put `target-style-locomotion-v2`, `constrained-fit-study-v2` and `workers/avatar-model` from it on `sys.path`.
3. Run `fit(candidate.png, parts, template)`.
4. Call `render_fitted_roster.read_parts(...)`, then `renderer.render("avatar", view, renderer.rest)`.
5. Set `prepare_kit_all_views.OUT` before measuring rings.

A painting's sheet comes from its paint call: `modal.FunctionCall.from_id(<providerCalls["paint/1"]>).get()`
returns `sheet` and `descriptor`. The 2026-11-21 trial and proof scripts were `prove_animals.py` and
`head_trial.py`. They were in a session scratchpad and are not in git, so rewrite them from this description.

## Rules (owner rulings, do not bend)

- **Nothing that exists may change.** A published model never changes. Humans and dressed animals must
  render exactly as today; prove it byte for byte.
- **No new ways to fail.** Make Model must never fail on an arbitrary limit. Every limit needs 5 avatars
  of headroom, measured on real models. Prefer falling back to the current templates over failing.
  Never retry a deterministic failure with identical inputs.
- Anything bipedal is accepted. Quality gates (recognition, rig check) stay; ask before loosening one.
- **No environment variables that need setting in Railway.** Use code defaults.
- Never name, cite or describe another game, its characters or its art, anywhere in the repo
  (`AGENTS.md`, `scripts/ip-hygiene.test.mjs`).
- No images or audit dumps in `docs/screenshots`, `docs/evidence` or `docs/audits`: use the gitignored
  `.ci-evidence/` and attach what the owner needs.
- **Do not deploy the Modal worker or push to `main` without the owner's go-ahead.** Deploy only when
  `avatar-model:dispatch` is `[]`. A job's three styles must render on one movement bundle. A deploy
  takes 35–70 minutes. Keep the previous deploy script as the rollback.
