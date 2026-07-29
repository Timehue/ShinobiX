# Premium Cinematic Visual-Novel Overhaul Plan

**Date:** 2026-07-28
**Status:** Implemented as a certified hybrid story-wide release (pilot, renderer, authoring, rollout library, rollback, and asset QA)
**Recommended pilot:** Ashen Leaf, level 4 main-story chapter, plus one short branching interlude

## Implementation completion snapshot

The practical browser-game release described by this plan is implemented:

- the production reader is a full-screen cinematic stage with deterministic
  direction, typewriter pacing, restrained motion, biome atmosphere, sparse
  semantic audio, global mute, reduced-motion, and low-end modes;
- the Ashen Leaf level-4 chapter and level-20 interlude have bespoke,
  line-directed environment and actor packages;
- all story events use the same premium stage, with chapter-specific shipped
  art retained for openings/endings and 16 visually certified village scene
  families directing intermediate pages by written location;
- 14 recurring leads, Kage, elders, and pilot actors resolve to consistent
  transparent stage cutouts;
- the editor supports event/page/line direction, production preview, cinematic
  validation, and Auto/Cinematic/Classic modes;
- players can switch to the persistent Classic Reader from the cinematic
  overlay and return to Cinematic Mode without changing story state;
- next-shot backdrops and actor art preload without loading the complete library;
- `npm run qa:cinematic-vn` certifies dimensions, alpha, presence, and per-file
  budgets for the shipped cinematic package.

This completion uses the controlled hybrid recommended in the honest-quality
section. It does not claim that 292 pages received unique paintings or
frame-by-frame animation. The existing chapter paintings remain valuable hero
art, the new scene-family library prevents flat single-image repetition through
connective pages, and rare Ashen pilot reveals demonstrate the bespoke path
available to admins without more component code.

## 1. Recommendation

Upgrade the player-facing story reader into a full-screen, art-directed
2.5D motion-comic presentation. Use automatic direction for connective scenes,
then add hand-authored direction, layered environments, consistent pose sets,
and bespoke art to chapter openings, reveals, major choices, boss entrances,
and endings.

The goal is not full character animation or generated video. The goal is for
the story to feel staged and directed:

- the backdrop has restrained camera motion and atmosphere;
- characters enter, settle, react, and receive speaker focus;
- dialogue types in and can be completed with a tap;
- important lines can change the grade, camera, sound, or transition;
- choices deliberately interrupt the motion and feel consequential;
- chapter-to-battle and battle-to-epilogue handoffs feel continuous.

The owner has authorized new asset creation and asked for the closest practical
result to AAA quality. The production bar is therefore premium composition,
consistency, direction, sound, responsiveness, and polish, not merely adding
CSS animation to the current portraits.

## 2. Honest quality target

### Target

The target is an AAA-inspired presentation within a browser RPG:

- every main chapter has intentional shot progression rather than one painting
  moving behind every line;
- major characters remain visually consistent across neutral, tense, combat,
  injured, and transformed states;
- important environments have clean background, midground, and foreground
  layers for real depth rather than a flat-image zoom;
- hero moments receive bespoke compositions, lighting, transitions, and sound;
- connective dialogue still uses the automatic direction system, but it must
  look authored rather than random;
- desktop and mobile receive separately reviewed compositions;
- no visible low-quality asset, crop, hand, face, costume, or continuity error
  ships simply because it was generated quickly.

### Meaning of "AAA" in this plan

It is realistic to pursue AAA-level presentation discipline: a locked visual
language, model consistency, cinematic shot design, layered motion, strong
sound, excellent interaction polish, and aggressive visual QA.

It would not be honest to promise the frame-by-frame animation volume of a large
console studio across 292 story pages. The intended result is premium 2.5D
cinematic storytelling comparable in spirit to a high-budget illustrated RPG,
not a fully animated television series.

### What this plan intentionally does not promise

- fully animated anime scenes;
- lip sync for every NPC;
- a unique background or pose for every story page;
- AI-generated video;
- bespoke frame-by-frame animation across all 292 existing main-story pages.

Those approaches would multiply asset and review work and create visual
inconsistency. This plan spends bespoke effort where the camera, story, and
player attention make it visible, while applying a high baseline everywhere.

## 3. Current-state findings

The existing implementation already provides a strong functional base:

- `TriggeredVisualNovel.tsx` owns page and line navigation, branching choices,
  trait gates, battle handoffs, replay, skip, finale behavior, and duplicate
  action protection.
- `types/vn.ts` provides a serializable event/page/line schema used by built-in
  story content and admin-authored events.
- The admin visual-novel builder can edit pages, dialogue, choices, backdrops,
  and left/right character images, and can preview through the real reader.
- Story integrity tests verify portrait coverage, scene paths, trait-gated
  graph reachability, and proper endings.
- The game already has global mute handling, synthesized Web Audio cues,
  reduced-motion detection, low-end-device detection, lazy loading, and story
  certification scripts.

The main presentation constraints are:

- the reader is rendered inside `.card.cinematic-card`, so it still reads as a
  web-game panel rather than a scene;
- the backdrop, portrait cards, narration card, and dialogue box are mostly
  static;
- 292 main-story pages reuse 36 unique chapter paintings; the wider story scene
  library contains roughly 97 paintings once interludes, road events, and rifts
  are included;
- there are roughly 96 story portrait files, but they are primarily square
  portraits with their own dark backgrounds rather than transparent actors;
- only a handful of story pages explicitly swap a portrait to a transformed or
  alternate state;
- story backgrounds are generally 1024-pixel WebP images, suitable for
  restrained movement but not aggressive zooming;
- mobile currently depends on a fixed-height picture area above stacked
  dialogue, so full-screen conversion must preserve readability and safe-area
  behavior.

## 4. Product scope

### Included in the first release

1. Main village story chapters.
2. Main-story interludes and epilogues.
3. Story road events.
4. Story reckonings that already use `TriggeredVisualNovel`.
5. Existing branching, trait, reward, skip, replay, and battle semantics.
6. Admin preview of cinematic presentation.
7. Classic fallback mode.

### Included automatically, but without bespoke direction at first

- rift conversations;
- Chronicle Scribe conversations;
- Wandering Sage scenes;
- zero-reward conversation events;
- existing admin-authored visual novels.

These can receive safe automatic motion from the same renderer. Their editor
metadata and bespoke direction can follow after the main story is proven.

### Excluded from the first release

- the opening `IntroCinematic`, which remains its own bespoke sequence;
- combat renderer changes;
- recorded voice acting;
- AI-generated video or runtime image generation;
- rewriting story dialogue or branching;
- replacing every existing story asset.

## 5. Visual design rules

The cinematic reader should feel related to the world-entry cinematic without
copying its exact composition.

### Stage composition

- Mount player-facing story as a body-level full-screen overlay.
- Use the full viewport behind safe-area-aware controls.
- Put scene art edge-to-edge with a controlled vignette and color grade.
- Replace visible portrait cards with softly integrated actors:
  - transparent cutouts when available;
  - otherwise, use the existing portrait with a masked lower edge, restrained
    frame treatment, and background blending.
- Place dialogue in a lower cinematic panel that never covers faces.
- Keep progress, skip, audio, and accessibility controls small and consistent.
- Hide production/debug language such as generic trigger and reward details
  during story playback unless the specific scene needs them.

### Motion language

Automatic motion must be slow and subordinate to reading:

- background push: approximately 1.00 to 1.045 scale over 8-14 seconds;
- background pan: no more than approximately 3% of the image width;
- portrait settle: approximately 12-24 pixels with a soft fade;
- speaker focus: small scale/luminance change, not constant bouncing;
- idle breathing: extremely subtle and disabled for low-end/reduced-motion;
- atmosphere: limited biome particles, mist, light rays, snow, rain, or embers;
- transitions: 250-600 ms for ordinary pages, longer only for authored reveals;
- camera shake: short, rare, and tied only to explicit impact cues.

There should never be several strong motion effects competing with dialogue.

### Direction defaults

When no author metadata exists:

- choose focus from the active speaker;
- choose left/right composition from the existing actor slots;
- choose atmosphere from the event biome or village;
- alternate a gentle push and pan between pages to avoid mechanical repetition;
- use crossfade for normal pages;
- use no impact effect;
- preserve the same camera during consecutive dialogue lines on one page;
- stop or greatly reduce motion while choices are shown.

## 6. Technical architecture

### Preserve story logic

Do not rewrite branching, choice arming, battle launching, rewards, or completion
semantics as part of the visual overhaul. Keep `TriggeredVisualNovel` as the
flow controller until the cinematic renderer is certified.

### Add a presentation resolver

Create a pure module such as:

`shinobij.client/src/lib/vn-presentation.ts`

It should convert event, page, line, speaker, biome, user preferences, and
device tier into a stable render model:

```ts
type ResolvedVnPresentation = {
    mode: "classic" | "cinematic";
    shot: "wide" | "medium" | "close" | "detail";
    focus: "left" | "right" | "center" | "speaker";
    backgroundMotion: "none" | "push" | "pan-left" | "pan-right" | "drift";
    transition: "cut" | "crossfade" | "dip-black" | "whiteout" | "whip";
    tone: "neutral" | "warm" | "cold" | "danger" | "hollow" | "elegy";
    atmosphere: "none" | "embers" | "rain" | "snow" | "mist" | "motes";
    impact: "none" | "soft" | "heavy";
    actorEntrance: "none" | "fade" | "left" | "right" | "rise";
    backgroundPosition?: string;
};
```

The exact union can be refined during implementation. The important constraint
is that automatic direction is deterministic and unit-testable.

### Add a presentational stage

Create a focused component such as:

`shinobij.client/src/components/CinematicVisualNovelStage.tsx`

Responsibilities:

- stage, backdrop layers, actor layers, grade, atmosphere, and transitions;
- typewriter dialogue and tap-to-complete;
- speaker focus and portrait entrances;
- choice presentation;
- skip, back, next, audio, and reduced-motion controls;
- desktop and mobile composition;
- no rewards, traits, persistence, or battle settlement logic.

`TriggeredVisualNovel` should pass it resolved content and callbacks.

### Keep a classic fallback

The existing reader should remain available during rollout:

- feature flag off;
- unsupported browser or asset failure;
- user-selected reduced presentation mode;
- emergency rollback;
- admin comparison during authoring.

The fallback should use the same story state, so switching presentation cannot
change progress or rewards.

### Full-screen and preview modes

The component needs two explicit render surfaces:

- `immersive`: portaled to `document.body`, body scroll locked, safe-area-aware;
- `preview`: contained within the admin preview overlay and visually scaled.

Admin preview must render the real cinematic stage, not a separate approximation.

## 7. Content schema

Add optional presentation metadata only. Existing events must remain valid and
receive automatic direction.

Recommended shape:

```ts
type VnCinematicDirection = {
    mode?: "auto" | "cinematic" | "classic";
    shot?: "wide" | "medium" | "close" | "detail";
    focus?: "left" | "right" | "center" | "speaker";
    backgroundMotion?: "auto" | "none" | "push" | "pan-left" | "pan-right" | "drift";
    backgroundPosition?: string;
    transition?: "auto" | "cut" | "crossfade" | "dip-black" | "whiteout" | "whip";
    tone?: "neutral" | "warm" | "cold" | "danger" | "hollow" | "elegy";
    atmosphere?: "auto" | "none" | "embers" | "rain" | "snow" | "mist" | "motes";
    actorEntrance?: "auto" | "none" | "fade" | "left" | "right" | "rise";
    impact?: "none" | "soft" | "heavy";
    titleCard?: boolean;
    ambience?: "auto" | "none" | "village" | "road" | "interior" | "hollow";
    cue?: "none" | "advance" | "reveal" | "omen" | "decision" | "battle";
};
```

Recommended placement:

- optional event-level defaults;
- optional page-level override;
- optional line-level cue for rare major beats;
- actor art may continue using the existing left/right fields initially;
- future actor-pose maps should use stable speaker slugs rather than duplicate
  data URLs.

Do not require authors to direct every line. A normal page should need zero
cinematic fields.

## 8. Interaction and pacing

### Dialogue behavior

- Type at approximately 70-90 characters per second.
- First tap completes the current line.
- A short guard prevents that same tap from advancing the completed line.
- Second tap advances.
- Back returns to the prior line/page without replaying loud cues.
- Keyboard support: Enter, Space, Right Arrow, and a documented back key.
- Keep the current duplicate-action lock around all flow-changing callbacks.

### Optional controls

Recommended for the first release:

- text speed: instant, fast, normal;
- motion: full, reduced;
- auto-play: off by default, optional;
- global mute control mirrored inside the full-screen overlay;
- skip scene with confirmation only when skipping could dismiss an unrecorded
  decision or unrewarded battle route.

### Choices

- stop typewriter and strong camera motion;
- tighten the composition around the speaker or central subject;
- retain the current 650 ms accidental-selection guard;
- show trait-gated choices exactly as the current flow resolver does;
- give the selected conclusion its own quiet aftermath beat;
- use stronger effects only when explicitly authored.

## 9. Art plan

New art is authorized. Existing art is reference material and fallback, not a
constraint on the final quality bar.

### Art-direction bible

Before producing the pilot assets, lock a short visual bible containing:

- line, rendering, texture, contrast, and color examples;
- anatomy and face-detail expectations;
- each village's palette, materials, weather, architecture, and lighting;
- actor scale, camera height, lens feel, and eye-line rules;
- costume continuity rules for rank, village, injuries, and story progression;
- permitted VFX motifs for chakra, Hollow influence, fire, frost, storm, and moon;
- clean examples of a character cutout, layered environment, hero shot, and
  mobile crop;
- a rejection sheet showing artifacts that must not ship.

The world-entry cinematic and strongest existing story portraits should seed
the direction, but the bible must make the style repeatable across many assets.

### Character model packages

Create a canonical reference sheet before generating alternate states for a
recurring character. Each major-character package should contain:

- canonical head-and-shoulders portrait;
- transparent waist-up neutral pose;
- transparent speaking/listening pose;
- transparent tense or combat-ready pose;
- one story-specific emotional or transformed pose where needed;
- closed-eye/blink variant only when it adds value;
- optional mouth-open variant for restrained speaking animation;
- palette and costume notes;
- stable apparent height, eye line, and facing direction.

The four Kage, recurring guides/captains/elders, major antagonists, and Hollow
forms receive full packages. Secondary recurring characters receive neutral and
tense cutouts. One-scene minor characters can retain a premium portrait
treatment unless a wider pose is essential to the shot.

All variants should be created from the canonical reference, not independently
prompted from text. Recognition and costume continuity are release requirements.

### Environment packages

Replace the single-background-per-chapter dependency with shot packages. A main
chapter should normally receive:

- one wide establishing environment;
- one medium conversation composition;
- one detail/reveal composition when the script changes the visual subject;
- one boss or climax environment/state;
- clean foreground, midground, and background layers for at least the hero shots;
- day/night, weather, damage, fire, ice, or Hollow variants only when the script
  visibly changes the same location;
- author-set desktop and mobile focal points.

Layered scenes should be authored as separate transparent WebPs where practical.
Simple scenes may use a depth map or carefully masked planes. No fake parallax
should expose missing edges or make architecture slide independently.

### Hero-shot policy

Create bespoke full-frame art for:

- first reveal of each village's central conflict;
- major companion/mentor introduction;
- irreversible choice or betrayal;
- boss transformation and entrance;
- finale decision;
- epilogue image that communicates the player's consequence.

Hero shots may temporarily remove normal actor staging and dialogue chrome. They
should be rare enough to remain special and should carry the strongest
transition, grade, and sound direction.

### Player-avatar treatment

Player avatars are user-selected and cannot have a prebuilt pose package.
Create a premium framing system that can accept arbitrary avatar aspect ratios:

- clean silhouette/masked lower edge;
- face-safe crop detection or author-controlled anchor;
- rim light and grade matched to the scene;
- restrained depth shift;
- fallback monogram only when the avatar genuinely fails;
- never distort or regenerate the player's chosen identity at runtime.

### Pilot asset package

For Ashen Leaf level 4 plus the selected branching interlude, create:

- canonical reference/model sheets for the recurring pilot cast;
- at least neutral and tense transparent cutouts for each primary speaker;
- three or more environment compositions when the script changes location or
  visual subject;
- separated depth layers for the opening and climax;
- one bespoke reveal or choice hero shot;
- one boss-handoff shot;
- mobile focal-point metadata for every new environment;
- matching ember, smoke, light-ray, and Rootfire overlays where appropriate.

The pilot should use the real target pipeline, not temporary low-quality art that
would need to be discarded after approval.

### Generation and review workflow

1. Build a shot list directly from the chapter pages.
2. Select canonical existing references for each character and location.
3. Generate small contact sheets or low-cost concepts for composition selection.
4. Approve composition before producing final-resolution variants.
5. Generate/edit from the approved reference, keeping seed/reference continuity
   wherever the tool supports it.
6. Remove backgrounds and split layers only after the final image is accepted.
7. Inspect at original resolution and in the real desktop/mobile stage.
8. Reject or repair face drift, costume drift, bad hands, duplicate anatomy,
   unreadable silhouettes, inconsistent light, and crop problems.
9. Optimize only after visual approval.
10. Record the accepted asset in a manifest with character, pose, chapter, source
    reference, dimensions, and intended usage.

### Asset rules

- source masters kept at a resolution suitable for final crop and cleanup;
- optimized WebP or AVIF delivery variants, with alpha where needed;
- no text, UI, watermarks, or baked particles unless the image is a deliberate
  one-use hero composition;
- stable actor, location, pose, and state naming;
- consistent eye line, scale, lighting direction, costume, and village identity;
- composition-safe margins for desktop and mobile;
- no aggressive upscaling of the current 1024-pixel backgrounds;
- image-size budgets recorded in the build-size audit;
- preload only current/next-shot delivery assets, not source masters;
- every generated asset passes a visual continuity and technical QA checklist
  before it is wired into story data.

### Story-wide production order

Prioritize complete narrative packages rather than producing all portraits first:

1. Ashen Leaf pilot chapter and interlude;
2. first chapter for the other three villages;
3. recurring lead/Kage model packages for all villages;
4. remaining main chapters one tier across all villages;
5. finales, transformed states, and epilogues;
6. interludes, reckonings, and road-event hero shots;
7. lower-priority conversation families.

This lets each shipped tier look coherent while building a reusable cast and
environment library.

## 10. Audio plan

Recommended first release: ambience and small synthesized cues, no voice acting.

- Respect the single existing global mute setting.
- Reuse the safe Web Audio pattern from the intro and story-fight cues.
- Add very low-volume biome ambience while a scene is open.
- Add short cues for title, advance, reveal, decision, omen, and battle handoff.
- Do not make a sound for every character of typed dialogue.
- Do not restart ambience on every page.
- Fade ambience cleanly before battle, completion, cancellation, and unmount.
- Audio failure must remain silent and must never block story flow.

## 11. Mobile, performance, and accessibility

### Mobile

- Design at 390x844 and 430x932 first, then verify wider tablets.
- Keep dialogue and choices above safe-area insets.
- Never place primary controls behind the navigation or mobile browser chrome.
- Use `backgroundPosition` metadata for important mobile crops.
- Clamp dialogue height and scroll only the text/choices area when necessary.
- Keep faces visible when the virtual viewport becomes short.

### Low-end devices

- Reuse `isLowEndMobile()` and the existing lite-effects class.
- Disable blur-heavy layers, duplicate mist, breathing, and extra particles.
- Limit animated DOM nodes.
- Pause requestAnimationFrame work while the tab is hidden.
- Prefer CSS transforms/opacity over layout-affecting animation.
- Preload only the next page's backdrop and active actor art.

### Reduced motion

- Respect `prefers-reduced-motion`.
- Show full text immediately or honor the user's explicit text-speed choice.
- Replace pans, zooms, shakes, and whips with fades or cuts.
- Keep all content, choices, cues, and progress behavior equivalent.

### Accessibility

- Preserve visible keyboard focus.
- Give the dialogue region and speaker changes appropriate live-region behavior
  without rereading the entire stage.
- Do not encode speaker or danger solely through color.
- Maintain touch targets of at least 44 CSS pixels.
- Verify contrast over the brightest and darkest story backdrops.
- Provide meaningful alt text for active actors while marking decorative
  atmosphere as hidden.

## 12. Implementation phases

### Phase 0: visual prototype and locked decisions

**Deliverable:** one static/clickable Ashen Leaf level 4 composition at desktop
and mobile sizes, plus the pilot art-direction bible and shot list.

- compare existing card layout against cinematic full-screen layout;
- lock the visual bible, rejection examples, and asset naming conventions;
- turn the pilot script into an explicit shot/actor/environment list;
- approve canonical references for every recurring pilot actor;
- settle dialogue-box shape, portrait blending, title treatment, and control
  placement;
- confirm motion strength and whether the player avatar stays visible;
- confirm audio and autoplay policy;
- establish before/after screenshots as the visual contract.

**Exit gate:** owner approves the composition before renderer refactoring.

### Phase 1: schema and deterministic presentation resolver

**Deliverable:** optional cinematic types plus unit-tested automatic direction.

- add optional event/page/line presentation metadata;
- add pure automatic defaults by event family, biome, page index, and speaker;
- add feature-flag and classic-mode resolution;
- add tests proving old content receives valid defaults;
- add tests proving presentation metadata cannot affect branching or rewards.

**Exit gate:** all current content compiles unchanged and existing story tests pass.

### Phase 2: cinematic stage foundation

**Deliverable:** full-screen stage using existing assets.

- add immersive and admin-preview render modes;
- implement scroll lock, safe areas, letterbox, backdrop, vignette, actor slots,
  dialogue, controls, and choices;
- implement typewriter and tap-to-complete;
- implement speaker focus and restrained page transitions;
- implement asset-error fallbacks;
- retain existing flow callbacks and action locks.

**Exit gate:** the full pilot can be completed, skipped, replayed, branched, and
handed into battle with behavior matching the classic reader.

### Phase 3: motion, atmosphere, and audio

**Deliverable:** the automatic motion-comic layer.

- add background motion presets;
- add actor entrance and idle presets;
- add biome atmosphere;
- add tone grades, authored impacts, whiteout/dip-black transitions;
- add synthesized ambience and cues;
- add reduced-motion and lite-effects variants;
- stop all animation/audio cleanly on hide or unmount.

**Exit gate:** no layout shift, stuck audio, duplicate cue, or action double-fire
in repeated navigation tests.

### Phase 4: hand-directed pilot content

**Deliverable:** Ashen Leaf level 4 plus one branching interlude at the intended
production quality.

- author direction only where automatic choices are insufficient;
- produce and integrate the full pilot character, environment, layer, overlay,
  and hero-shot package defined in section 9;
- direct chapter title, first reveal, main choice, boss entrance, and battle handoff;
- verify arbitrary player-avatar aspect ratios;
- record desktop/mobile before-and-after captures;
- gather owner feedback on pacing, motion, and art integration.

**Exit gate:** owner approves the quality bar and confirms whether to proceed
story-wide.

### Phase 5: admin authoring tools

**Deliverable:** cinematic fields in the existing VN builder.

- add an Auto/Cinematic/Classic selector;
- add page-level shot, focus, transition, tone, atmosphere, and crop controls;
- put rare line cues behind an Advanced section;
- make Auto the default;
- show real-time preview through the production stage;
- add validation for invalid enums, missing actor art, unsafe self-loops, and
  out-of-range background positions;
- preserve existing saved events when new fields are absent.

**Exit gate:** an admin can create a good default cinematic VN without touching
advanced direction.

### Phase 6: story-wide rollout

Roll out in controlled tiers:

1. all first chapters across four villages;
2. all main chapters;
3. finales and epilogues;
4. interludes and reckonings;
5. road events;
6. other `TriggeredVisualNovel` conversation families;
7. admin-authored events after compatibility review.

For each tier:

- enable automatic motion first;
- review every page for crop, portrait, and dialogue overlap;
- add hand direction only to hero beats;
- produce the approved character/environment packages and hero shots for that
  tier before calling it visually complete;
- retain existing art only where it clears the premium visual and continuity bar;
- keep a one-click classic rollback.

### Phase 7: certification and cleanup

**Deliverable:** production-ready cinematic reader.

- remove temporary pilot flags after successful rollout;
- retain the permanent classic fallback;
- document cinematic authoring conventions;
- update art generation and integrity scripts;
- add size budgets and preload rules;
- archive comparison screenshots and certification results.

## 13. Verification plan

### Unit and content tests

- automatic presentation resolver is deterministic;
- every direction enum resolves to a supported class/state;
- invalid or absent metadata falls back safely;
- all referenced scene, actor, and alternate-pose assets exist;
- every story graph remains walkable under every trait scenario;
- choices still arm after the existing delay;
- duplicate input cannot advance twice, choose twice, or launch two battles;
- reduced-motion produces equivalent story state;
- classic and cinematic modes reach the same terminals.

### Component tests

- typewriter complete-then-advance behavior;
- back across line and page boundaries;
- replay after a conclusion;
- skip/cancel behavior by event family;
- finale labels and reward copy;
- actor focus for left, right, narrator, and unknown speakers;
- failed scene and portrait image fallbacks;
- body scroll restoration after every exit path;
- audio stops on cancel, battle handoff, completion, and unmount.

### Browser verification

Required viewports:

- 390x844;
- 430x932;
- 768x1024;
- 1366x768;
- 1920x1080.

Required flows:

- normal linear scene;
- branching interlude;
- trait-gated choice;
- choice with conclusion then battle;
- chapter boss handoff;
- replay;
- skip/cancel;
- refresh/restored state where applicable;
- admin preview;
- missing asset fallback;
- global mute on/off;
- reduced motion;
- lite-effects mode.

### Build and release gates

- client build;
- lint for touched files;
- relevant unit/content tests;
- mobile touch-target test;
- story v10 certification;
- asset-path and build-size checks;
- Playwright screenshot comparison for the pilot and one scene per rollout tier.

## 14. Estimate and staffing

These are person-day ranges, not calendar commitments. The premium target adds
substantial art direction and review work; generation time is not the bottleneck.

| Work | Estimate |
| --- | ---: |
| Art-direction bible, shot list, and visual prototype | 2-4 days |
| Schema and presentation resolver | 1-2 days |
| Full-screen cinematic stage | 4-7 days |
| Motion, atmosphere, audio, accessibility | 4-7 days |
| Pilot asset production and continuity review | 4-8 days |
| Ashen Leaf pilot direction and integration | 3-5 days |
| Admin editor support | 2-4 days |
| Story-wide character/environment/hero asset production | 40-90 days |
| Story-wide direction, crop review, and metadata pass | 8-16 days |
| Certification, fixes, and release cleanup | 3-5 days |
| **Premium pilot through approval** | **18-33 person-days** |
| **Complete premium story rollout** | **71-148 person-days** |

The wide full-rollout range is intentional. It depends on how many generated
assets pass on the first attempt and how many chapters need extra location,
expression, or transformed-state art. A consistent recurring-cast and
environment library remains a multi-week content effort even when generation
itself is fast, because art direction, continuity, cleanup, integration, and
mobile composition are the expensive work.

## 15. Pilot decisions resolved

Recommended defaults are included so work can proceed without redesigning the
plan after every answer.

1. **Initial content scope**
   The full-screen automatic renderer is compatible with existing triggered
   story/conversation events. Bespoke art and direction are limited to the
   Ashen Leaf level-4 chapter and level-20 interlude in the pilot.

2. **Player-avatar presence**
   Keep a real player avatar visible with the integrated actor treatment. Hide
   the actor slot when no avatar exists instead of showing a cheap initials
   placeholder.

3. **Art investment: decided**
   New assets are authorized. Target the full premium pipeline in section 9:
   canonical model packages for major characters, layered environments, and
   bespoke hero shots, with existing assets retained only when they clear the
   target quality bar.

4. **Audio scope**
   Low ambience plus sparse semantic synthesized cues, no voice acting and no
   sound on ordinary dialogue advance.

5. **Text and autoplay**
   Normal typewriter by default, tap to complete/advance, and persistent Normal,
   Fast, and Instant text settings. Autoplay remains out of the pilot.

6. **Motion strength**
   Restrained motion during ordinary dialogue and strong effects only on
   explicitly authored reveals, impacts, and transitions.

7. **Pilot**
   Ashen Leaf level 4 main chapter plus the level-20 short branching interlude.
   This tests a chapter, multi-page choices, a timed reveal, four recurring
   actors, an evidence reveal, and the chapter-to-battle handoff.

8. **Rollout policy**
   Certify one story tier at a time and retain the serializable Classic mode as
   the fallback.

## 16. Definition of done

The overhaul is complete when:

- story playback feels like a full-screen directed scene rather than a card UI;
- recurring characters remain recognizably identical across their approved pose
  and expression packages;
- each premium main chapter has real shot progression and does not visibly reuse
  one flat painting for every location or reveal;
- hero moments have bespoke, visually inspected art and direction;
- all existing story paths, choices, traits, battles, rewards, and endings behave
  identically to the certified classic reader;
- the automatic mode makes an undirected page look intentional;
- major chapter beats can be hand-directed without component code changes;
- mobile composition is readable and face-safe at the required viewports;
- reduced-motion and low-end modes retain the complete experience;
- audio follows the global mute and never survives the scene;
- admins can preview and author cinematic direction without editing source code;
- all story, asset, build-size, accessibility, and browser release gates pass;
- classic mode remains available for rollback.
