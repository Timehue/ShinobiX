# Shipped pet asset size fix — 2026-09-23

Base: locally known `origin/main` at `b2b5e95718b6bbfee93362ea027938310ff4581a`. Work was performed in an isolated checkout. The active main working tree, close-view GLBs, Raijin assets, gameplay rules, and deployment were not changed.

## Changes

- Production Vite copy excludes the remaining three resolver-replaced full models: `starter-fire-l.glb`, `roster/rare-1.glb`, and `roster/standard-7.glb`. They remain in `public/` for animation authoring. Normal runtime URLs select their `showdown-v2` counterparts.
- The five breeding Mythic battle LODs (`roster/mythic-{10,11,12,13,14}`) retain their meshes, rig, clips, and close-view sources while using 1024px WebP PBR maps instead of embedded 2048px copies. Their five impostor atlases and both generated manifests were rebuilt.
- Each approved software impostor now uses a small generated atlas-content hash for its cache URL. A battle-only texture change therefore invalidates the matching atlas even when the close-source model URL is unchanged. The map adds 9,112 raw bytes to the generated client source.
- CI requires full structural, LOD, and impostor certification before building its client artifact. `verify-dist.mjs` checks the exact 477 selected source/LOD/impostor files by byte count and SHA-256 and rejects extra GLBs or WebPs in `dist/pet-models`.

## Measured file savings

| Runtime pet-asset family | Base bytes | Candidate bytes | Change |
| --- | ---: | ---: | ---: |
| Selected full GLBs | 88,308,428 | 88,308,428 | 0 |
| Resolver-replaced full GLBs still copied | 1,612,852 | 0 | -1,612,852 |
| Warfront/Rally LOD GLBs | 54,027,216 | 52,336,952 | -1,690,264 |
| Warfront impostor WebPs | 13,481,120 | 13,483,002 | +1,882 |
| **Runtime pet-asset total** | **157,429,616** | **154,128,382** | **-3,301,234 (2.10%)** |

The five edited LODs alone fall from 5,083,956 to 3,393,692 bytes, with unchanged triangle counts. `mythic-11` falls from 1,075,464 to 696,188 bytes; `mythic-14` from 975,088 to 603,452 bytes. Source/LOD pairs carrying byte-identical texture images fall from 158 to 153, and repeated encoded image payload across those remaining pairs falls from 25,381,792 to 21,534,198 bytes. These are package measurements, not load-time or GPU-memory measurements.

## Verification

- Full LOD `--check --quiet`: **159/159 pass**, 5,919,006 source to 1,612,613 LOD triangles.
- Full impostor `--check --quiet`: **159/159 pass**.
- Structural certification: **160/160 identities pass**, 159 distinct assets, zero reported rig, animation, anatomy, or tail-weight failures.
- Focused source/LOD routing and impostor tests: 25 checks pass. CI workflow contract: 12 checks pass.
- Client build, server build, client lint (zero errors, 14 existing warnings), `verify-dist`, and `sizecheck` pass. The verifier was also observed rejecting a deliberately corrupted built LOD and an extra retired GLB, then passing after the build output was restored.
- All five rebuilt 128px battle atlases keep the same occupied pixels as their originals. Visible-color PSNR spans 42.89–46.07 dB, with 0.78–1.21 mean absolute color error on a 0–255 scale. Local Chromium QA loaded the edited `mythic-11` and `mythic-14` LODs in front and four-angle views with HTTP 200 model responses and no page/request errors. Screenshots are in `shinobij.client/.tmp/pet-asset-size-qa/`.

## Limits and next trial

Chromium QA used a software WebGL renderer. No physical mobile device, production CDN/cache, cold-entry timing comparison, or Linux CI run was available. Smaller files alone do not prove faster player entry. The remaining 153 source/LOD pairs repeat 21.5 MB of compressed image payload; a broader 1024px battle-texture rollout or shared external texture contract should be piloted against representative species, real Warfront/Rally camera views, network transfer, GPU memory, and physical-device frame pacing before changing the full bank. The lossless impostor policy was preserved because it protects crisp edges on the software fallback.
