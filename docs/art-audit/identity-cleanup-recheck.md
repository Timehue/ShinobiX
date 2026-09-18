# VN identity and obsolete-art cleanup — 2026-09-18

## Recheck scope and findings

Refetched the live public event-image manifest and all 268 assets. The earlier portrait fingerprints were unchanged. Every slot is accounted for in [live-art-recheck.json](live-art-recheck.json):

| Slots | Disposition |
| --- | --- |
| 120 legacy page portraits | Retire only matching reviewed bytes; retain later uploads |
| 124 legacy backgrounds | Same protection; 121 are newly covered in this recheck |
| 4 old event-avatar records | Not used by premium VN cast resolution; included in the storage cleanup list |
| 20 dungeon-specific assets | Active backdrop, tile, Warden and rare-beast slots; retained |

The 124 background slots contain 45 unique images. Four comparison sheets were reviewed against the current scene descriptions and shipped artwork. Several legacy images depict unrelated people or the wrong location; one pet background is a square ninja portrait. These were separate from the earlier 120-slot portrait review.

The 20 dedicated dungeon images were also visually reviewed: each biome has its own matching entrance, card altar, masked Warden and rare beast. They belong to active dungeon-specific slots and are intentionally retained.

The static catalog includes 341 event/replay variants, 1,225 pages and 330 resolved assets. The post-cleanup inventory has **zero missing assets**. A new catalog regression checks that removing every reviewed export restores the original background on every affected dialogue line, including compacted replay branches. This caught and fixed an obsolete `/scenes/<story>.png` fallback; story fallbacks now use the actual `/scenes/story/<story>.webp` files.

## Additional fixes

- The separate dungeon reader now hydrates and verifies legacy art, resolves the current background, and keeps dedicated dungeon uploads. It cannot reintroduce an old portrait through a second raw shared-image lookup.
- The Warden combat handoff verifies legacy portrait bytes before sending them to the arena. New uploads in old slots survive; character-bound uploads take precedence. The account check still occurs after asynchronous work and before the fight starts.
- Explicit editor image removal uses `DELETE`, including the old left/right slot. Empty fields during ordinary saves remain non-destructive. Previously an empty `POST` was rejected and the image returned on reload.
- The delete endpoint removes the R2 object before removing database references. An R2 failure leaves the library record available for retry instead of claiming successful cleanup.
- The manifest version now reaches the CDN URL and its existence cache. Previously `/api/img?...&v=...` redirected to an unversioned CDN URL, allowing old cached bytes to reappear after an update. Object writes/deletes invalidate local existence checks.

## Removed locally

- The unused deprecated Story Hall renderer, and its now-unnecessary portrait helper.
- The unreachable World Map VN renderer after the unconditional modern-reader return.
- Nine superseded public images: **1,547,816 bytes** removed from the shipped asset tree. They had no consumers in the full catalog or exact references in application/API/shared source. Paths and original hashes are in [removed-local-art.json](removed-local-art.json); the tracked originals remain recoverable from Git.
- Four duplicate legacy test images. The original bytes remain once in the consolidated hash-named fixture collection outside `public`.

The retirement guards and archived regression fixtures remain necessary for existing live image records and cached event data. They are not unused production art.

## Verification

- The 90-test VN/dungeon suite passes, including the updated current-asset completeness assertion. The new catalog-wide retirement regression also passes.
- The 62-test storage/art suite passes, covering all 244 reviewed slot fingerprints, replacement uploads, explicit deletion, CDN versions and R2 deletion failures. This suite overlaps the VN suite.
- The client's pinned TypeScript 6.0.3 build and focused ESLint checks pass. The root's older TypeScript 5.9.3 is not the client's build compiler.
- All **246 browser cases passed**: 119 affected pages at both desktop and phone widths (238 cases), six actual dungeon-reader cases, and two first-paint/replacement cases. The full sweep has 238 unique results and zero horizontal overflow. Sweep and dungeon evidence is in `tmp/vn-art-recheck/verified`; the first-paint script reports its assertions to stdout. The main sweep can resume already-verified pages with `--resume`; it verifies decoded images, resolved portrait/background paths, page errors and horizontal overflow.

From `shinobij.client`, use the lightweight real-game QA server:

```text
node node_modules/vite/bin/vite.js --config scripts/vite.vn-art-qa.config.mjs --host 127.0.0.1 --port 4173 --strictPort
node scripts/vn-live-art-qa.mjs
node scripts/vn-dungeon-art-qa.mjs
node scripts/vn-identity-first-paint-qa.mjs
node --import tsx --test src/lib/vn-retirement-catalog.test.ts
node node_modules/typescript/bin/tsc -b --pretty false
```

## Live storage cleanup status

No production records or CDN objects were deleted. [live-cleanup-manifest.json](live-cleanup-manifest.json) lists the 248 exact cleanup candidates, their byte hashes and rollback fixtures.

Deploy the corrected image-delete endpoint and client first. An authenticated admin can then re-fetch each candidate, compare its SHA-256 with the manifest, and delete only unchanged matches through `/api/images`. Skip changed bytes and keep all 20 active dungeon-specific assets. Verify the refreshed manifest and representative scenes afterward. Rollback uses the archived fixture bytes as an image upload to the recorded ID.

Deleting through the currently deployed endpoint would leave CDN objects behind, which is why the live purge is staged rather than reported as completed. Private/unpublished creator references were not available in this public audit.
