# VN identity and obsolete-art cleanup — 2026-09-18

## Recheck scope and findings

Refetched the live public event-image manifest and all 268 assets. The earlier portrait fingerprints were unchanged. Every slot is accounted for in [live-art-recheck.json](live-art-recheck.json):

| Slots | Disposition |
| --- | --- |
| 120 legacy page portraits | Retire only matching reviewed bytes; retain later uploads |
| 124 legacy backgrounds | Same protection; 121 are newly covered in this recheck |
| 4 old event-avatar records | Not used by premium VN cast resolution; included in the storage cleanup list |
| 20 dungeon-specific assets | Tile, Warden and rare-beast slots retained. The 5 entrance backdrops were retired on 2026-09-19 (see below) |

The 124 background slots contain 45 unique images. Four comparison sheets were reviewed against the current scene descriptions and shipped artwork. Several legacy images depict unrelated people or the wrong location; one pet background is a square ninja portrait. These were separate from the earlier 120-slot portrait review.

The 20 dedicated dungeon images were also visually reviewed: each biome has its own matching entrance, card altar, masked Warden and rare beast. They belong to active dungeon-specific slots and are intentionally retained.

**Revised 2026-09-19:** the five entrance backdrops predate the cinematic entrance art that now ships for every dungeon (`/scenes/story/cinematic/side-stories/craft-dungeon-<biome>.webp`), and the dungeon screen showed them in its place. The owner approved retiring them by exact bytes (`RETIRED_DUNGEON_BACKDROPS` in `lib/vn-retired-artwork.ts`, checked by `useVerifiedSharedArt` in the dungeon reader). The altar, Warden and rare-beast uploads have no built-in counterpart and stay.

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

No production records or CDN objects were deleted. [live-cleanup-manifest.json](live-cleanup-manifest.json) lists the 253 exact cleanup candidates (the 248 above plus the 5 dungeon entrances added on 2026-09-19), their byte hashes and rollback fixtures.

The corrected image-delete endpoint is live (fda38b311). The client must also include the fail-closed check (24414bc2b and later): before it, a failed check kept the stored link, so deleting these uploads would have left dead links on 12 pages whose stale admin rows still point at them. After that, an authenticated admin runs `scripts/retire-old-vn-images.mts --apply` (see [creator-content-review.md](../creator-content-review.md)). It re-fetches each candidate, compares its SHA-256, deletes only unchanged matches through `/api/images`, and reads each slot back. It skips changed bytes and never touches the 15 retained dungeon uploads. Rollback (`--restore`) uploads the backed-up bytes to the recorded ID. Private creator references were not available in this public audit; the later [Creator content review](../creator-content-review.md) read them and found the stale admin rows mentioned above.
