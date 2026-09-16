# Pet encounter portrait audit

Date: 2026-09-15

The pet encounter could pair a discovered pet's name with a saved narrator portrait: the runtime changed the actor name but retained the encounter page's existing `rightImage`. Wild Boar's bundled artwork (`standard-9`) correctly depicts a boar. The screenshot is not the bundled `public/portraits/narrator.webp`.

## Scope and results

- Evaluated `petCardImage(pet, {})` for all 145 entries in `rawPetPool`; every result exists locally and all 145 files have distinct SHA-256 hashes. Rechecked after the fallback changes.
- Visually reviewed all 145 resolved pet card images on contact sheets, plus candidate replacement poses at larger sizes.
- Visually reviewed all 107 top-level `public/portraits/*.webp` story portraits; found no obvious name/image mismatch in that group.
- Frost Seal (`rare-31`) retains its existing icy seal-lion appearance. The approved `visualReview` in `public/pet-models/roster-manifest.json` explicitly describes that anatomy, so it is not a mistaken feline assignment.

## Corrected static card fallbacks

All paths below are under `shinobij.client/public/pet-poses/`.

| Pet | Defect in prior idle image | Reviewed replacement |
| --- | --- | --- |
| Forest Hawk (`standard-3`) | Two vertically stacked figures | `standard-3-windup.webp` |
| Brook Newt (`standard-30`) | Baked checkerboard background | `standard-30-recover.webp` |
| Spark Shrew (`standard-40`) | Two truncated figures | `standard-40-recover.webp` |
| Night Panther (`rare-2`) | Baked checkerboard background | `rare-2-recover.webp` |
| Volt Polecat (`rare-40`) | Two truncated figures | `rare-40-run-a.webp` |

`pet-battle-anim.ts` selects these existing same-character images only when a static card has no published or inline artwork. Shared body/portrait images, inline images, and palette variants retain their existing priority. Template IDs resolve the same replacements for UUID-owned pets and legacy timestamp encounter clones. Battle sprite methods and `petPoseImage` remain unchanged; no source image files were edited.

## Validation and limits

`node --import tsx --test shinobij.client/src/lib/pet-battle-anim.test.ts`: 52 tests passed, including all five corrections, template/clone identity, shared/inline/variant priority, and unchanged battle/pose-first behavior. Targeted `git diff --check` passed.

This is a local bundled-image and encounter-assignment audit. Shared uploads, arbitrary creator artwork, all battle animation frames, 3D model appearance, and production/CDN copies were not exhaustively verified. Distinct files and valid paths establish coverage, not a guarantee of every artistic detail. Existing source-pose extraction defects remain in the battle asset files; these changes repair their use as static fallback cards.

## Encounter fix validation

The live WorldMap and isolated cinematic preview now share `buildPetEncounterVn`, which binds both actor name and image to the discovered pet and clears legacy template actor portraits. Scene text, narrator attribution, scenery, choices, and cinematic direction are preserved.

The combined encounter, WorldMap routing, VN identity/presentation, story cast, and pet-image suite passed all 106 tests. Client TypeScript checking and targeted ESLint passed. Wild Boar and the five replacement fallback images were visually reviewed together. The local browser preview timed out, so browser layout validation was not completed. These are local source changes; no deployment was performed.
## Pre-release audit of similar identity failures

The follow-up review found and corrected these related cases:

- Live story-battle launchers and the legacy Story Hall launcher passed the chapter opening portrait as the boss image. They now let the sealed boss profile provide combat art. Legacy Story Hall also applies the same named-actor filter as the main VN reader.
- Dungeon player replies could display the Warden under the Player label. Player/narrator lines no longer display an opposing speaker portrait. The Warden resolver accepts only actor slots labeled Dungeon Warden (including left-side legacy staging), with a dedicated Warden upload first and canonical Warden art as fallback.
- Five breeding Mythics included animation aliases in portrait lookups, so another species' published body or portrait could replace their own. Portrait identity lookup now excludes animation aliases; reviewed animation stand-ins remain available only for pose/sheet/layer rendering.
- A published chromatic portrait could lose to the ordinary body image. Variant-specific artwork now takes precedence across those two image categories.
- Partial depth-layer uploads could combine different forms or palettes. The resolver now requires a complete three-layer set for one identity and palette.
- Animation frame counts could come from a different template or palette than the chosen sprite sheet. Metadata now comes from the exact selected sheet key, with the existing default when absent.

Expanded validation on the clean main-based release checkout: 135 targeted tests passed, covering story content, VN identity, encounter staging, dungeon/boss routing, pet images, and animation metadata. Targeted ESLint passed. No gameplay statistics, rewards, or combat outcomes changed.

Release validation: the main-based production client build (including TypeScript and generated-story checks), bundle size check, and release-asset check all passed. Existing main and production were healthy and matched commit 6d5e4cd1de46aafa37f6382897bdf3a4eb82b01b before release.
