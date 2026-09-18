# Live VN identity review — 2026-09-18

This extends the earlier avatar and White Silence fix to the public live portrait library. Changes are local and require deployment; no production image records were edited.

The subsequent [cleanup recheck](identity-cleanup-recheck.md) covers every public event-image slot, adds the omitted background paths, removes unused readers/assets and fixes persistent storage deletion. Its verification supersedes the limitations of this first portrait pass.

## Evidence

The public `/api/images?cat=event&ids=1&ver=1` manifest contained 268 image IDs. We downloaded all 120 page portrait slots and four event-avatar slots, compared them with the current 341-variant / 215-event catalog, and visually reviewed eight paired comparison sheets. All downloads succeeded.

| Portrait slots | Count |
| --- | ---: |
| Ashen Leaf chapters | 28 |
| Frostfang chapters | 27 |
| Moonshadow chapters | 27 |
| Stormveil chapters | 27 |
| Built-in Aura Sphere / Hidden Dungeon | 5 |
| System chest / pet templates | 5 |
| Legacy pet-template alias | 1 |
| Total | 120 |

The 120 slots reuse 31 distinct legacy images. Examples include Captain Yura receiving unrelated elder, masked-ninja and ice-monster portraits; Elder Sova receiving male ninja/monster art; and Mira Volt and Kite Harrow receiving several different faces. Twenty-three slots map to Narrator in the static templates, including three pet-template slots normally replaced with the encountered animal at runtime. One narrator slot even contains cavern scenery. A second portrait on that same page was shadowed by the first and is also covered.

The four event-avatar images are already ignored by the current premium cast resolver. They remain intact. This review covers the public live portrait manifest, not private drafts or a complete re-review of all background images.

Per-slot identities, original hashes, decisions and archived fixture paths are in [live-identity-audit.json](live-identity-audit.json). The earlier White Silence background correction remains in effect.

## Fixes

- Retire the 120 reviewed portrait slots only when downloaded bytes match their archived SHA-256 fingerprints. New bytes in an old slot, unreviewed creator art, and player uploads retain their overrides. The current cast appears while old slots are checked, preventing a first-paint identity flash. New uploads or failed checks restore the explicit override after verification. Checks are cached by versioned image URL.
- Store future editor portrait uploads with the actor identity in their key, instead of left/right position alone. Hydration follows that actor through side swaps; a changed actor cannot inherit a different actor's bound image. Changing a name in the editor clears the previous portrait field unless a replacement is supplied in the same edit.
- Use one shared hydration function for initial image loads, story triggers and late image loads. Preserve the already-selected animal and player art in active pet encounters so late template loading cannot replace the animal with a generic wizard.
- Resolve each speaker independently in the deprecated recovery Story Hall reader. It no longer reuses page 0's right portrait throughout a chapter; Narrator and Player have no unrelated NPC portrait.

Legacy positional uploads outside the reviewed manifest remain supported. Identity binding prevents new editor uploads from creating the same positional mismatch, but cannot establish the visual contents of an arbitrary image uploaded under a character's name.

## Verification

- 80 focused tests passed, including every archived portrait fingerprint, changed-upload preservation, custom art, actor swaps/renames, pet hydration and recovery-reader identity.
- 169 reader browser cases passed: all 118 distinct known affected pages at 1440×900, plus 51 phone cases at 390×844. Canonical portrait paths matched, images decoded, and there were no page errors or horizontal overflow. Selected screenshots were visually reviewed.
- Two additional browser cases held verification requests open to prove correct first paint, then verified exact legacy retirement and restoration of new bytes in the same slot.
- TypeScript passed before the final first-paint guard; focused ESLint passed including that guard. A repeat full-project TypeScript run was stopped after a prolonged run without diagnostics. The final guard passed both dedicated browser cases.

Run from `shinobij.client` with the development server on port 4173:

```text
node --import tsx --test src/lib/vn-shared-artwork.test.ts src/lib/vn-retired-artwork.test.ts src/lib/vn-artwork.test.ts src/lib/vn-presentation.test.ts src/lib/pet-encounter-vn.test.ts src/lib/story-trigger.test.ts src/lib/vn.test.ts
node scripts/vn-live-identity-qa.mjs
node scripts/vn-identity-first-paint-qa.mjs
```

The browser cases intercept image requests with archived live bytes and run the real reader. Results and screenshots are in `tmp/vn-identity-audit/verified` at the repository root. The legacy alias and the second portrait on the duplicated page are covered by fingerprint tests; the browser list contains unique pages available in the current catalog. The first-paint script uses isolated browser contexts for original and replacement bytes.
