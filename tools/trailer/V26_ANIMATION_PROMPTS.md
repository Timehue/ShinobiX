# V26 Actual-Animation Production Notes

## What changed

V26 replaces the V25 still-image pan/zoom treatment with generated image-to-video motion. Every story and combat shot before the end card comes from a 37-frame FramePack animation. The end card has a continuous push-in and animated snow.

## Character reference

- User avatar: `C:\Users\Tyler R\OneDrive\Pictures\Avi\Rill-Smith.gif`
- Rill production anchor: `tmp/trailer/cinematic-v25/001-rill-character-anchor-v25.png`
- Rill/Kael fight reference: `tmp/trailer/cinematic-v25/004-rill-vs-kael-impact-v25.png`

## Image generation keyframe sheet

- Mode: built-in image generation, reference-image-guided creation
- Saved sheet: `tmp/trailer/cinematic-v26/001-rill-kael-keyframes-v26.png`
- Purpose: lock the same Rill and Hollow Kael designs across four sequential combat poses before motion generation
- Production direction: create one clean 2x2 sequential anime action keyframe sheet, exactly four panels and no captions. Preserve Rill's pale skin, white hair, ice-blue eyes, open white coat, black fur mantle, black fitted shirt and dark pants. Preserve Hollow Kael as one distinct opponent. Panel order: low combat stance; airborne side kick; guarded impact with a circular ice-water chakra shockwave; three-point landing. Keep character count, faces, anatomy, costumes, lighting, icy court environment and screen direction consistent. Premium theatrical hand-drawn anime feature quality; no text, logos, duplicate bodies, extra limbs, face drift, costume changes or merged anatomy.

The sheet was used as identity/action reference. The optical-flow tween proof made from it was rejected because the in-betweens smeared Rill and is not present in the trailer.

## FramePack generation

The exact accepted per-shot prompts and seeds are recorded in `tools/trailer/framepack_batch_v26.py`. Shared quality direction:

> Premium theatrical hand-drawn anime feature animation with clear continuous subject motion. Preserve exact character identities, faces, white hair, ice-blue eyes, costume shapes, anatomy, body count, environment geometry, and lighting from the source frame. Stable linework. No text, logos, extra characters, duplicate bodies, extra limbs, face drift, costume change, flicker, camera shake, melting, warping, morphing, or anatomy overlap.

Accepted batch settings:

- Duration request: 1.0 second per source shot
- Output: 37 frames per generated clip
- Sampling steps: 18
- Guidance/distilled guidance: 9 / 10
- TeaCache: enabled
- TeaCache threshold: 0.14
- Unique deterministic seed per scene: 26101–26107

The final edit uses eight generated-motion shots: meter awakening, Rill/wolf step, Sunken Court activation, dash, kick shockwave, guarded impact, landing/rise and facial resolve.

## Excluded tests

- Stable Video Diffusion proof: identity was stable, but character performance was too subtle.
- Optical-flow pose tween: unacceptable smearing and disappearing anatomy.
- Original V25 still-pan shots: excluded from the V26 story/combat timeline.
