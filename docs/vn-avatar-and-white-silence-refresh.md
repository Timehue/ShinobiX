# VN avatar and White Silence refresh — 2026-09-18

## Findings and changes

- Square/wide player art occupied only 78% of a 300px-wide frame, then lost more space to decoration. It now fills a restrained frame up to 480px wide, sits just above the dialogue, retains the complete image, and stays readable while listening. Tall cutouts keep their existing treatment.
- The live White Silence opening used a 512×288 shared export, overriding bundled artwork. Three shared square portraits also replaced the current cast, including a bearded man in the narrator slot and two unrelated images on Harrow's pages.
- The reader verifies the six affected shared slots against the SHA-256 fingerprints in `src/lib/vn-retired-artwork.ts`. Only the exact reviewed legacy bytes are omitted; current cinematic background/cast resolution then applies. Future uploads to those same slots, arbitrary custom URLs, other chapters, and failed/offline checks retain their overrides. No production records are changed.
- A new 1536×1024 background is served from `/scenes/story/cinematic/storywide/frostfang-white-silence-dawn-v1.webp` (468,302 bytes). Its distinct URL avoids the old background's cache.

## Verification

From `shinobij.client`:

```text
node --import tsx --test src/lib/vn-retired-artwork.test.ts src/lib/vn-artwork.test.ts src/lib/vn-presentation.test.ts src/lib/vn-portrait-framing.test.ts
node scripts/vn-avatar-refresh-qa.mjs --live-proof
tsc -b --pretty false
```

The browser script exercises the real reader at 2513×1201, 1440×900, 390×844, 320×568, and 844×390 with square, wide, and tall avatars. Archived live exports, now consolidated under `e2e/fixtures/vn-identity-audit`, reproduce the production overrides without modifying them. It checks the replacement background, removal of narrator/player portraits during narration, restored Harrow art, readable avatar width, image loading, and overflow. `--live-proof` additionally verifies browser CORS and SHA-256 through the production image CDN redirect. Screenshots and metrics are written to `tmp/vn-avatar-refresh` at the repository root.

Results: 42 focused tests passed; 25 browser cases passed with no page errors or horizontal overflow; the live CDN fingerprint matched through a real browser fetch. TypeScript and focused ESLint checks passed.

Local changes require deployment before live users receive them. The subsequent [live identity review](art-audit/live-identity-review.md) extends coverage to the public portrait library and prevents a cold first-paint flash: the current cast is shown while reviewed slots are checked, and new uploads restore their explicit override. Since 2026-09-19 a failed check keeps the current cast. Verification is cached for the reader session.

## Generated artwork

Built-in imagegen, one generation. Exported to WebP with Sharp at quality 88, effort 6, without resizing. References: `public/scenes/story/story-frostfang-village-85-7.webp` (narrative layout) and `public/scenes/story/cinematic/storywide/frostfang-threshold.webp` (Frostfang materials and style).

Final prompt:

> Use case: illustration-story. Create one production landscape background for a dark fantasy visual novel, 1536x1024 or wider landscape at highest detail. Reference 1 is the narrative layout of the White Silence, reference 2 is the canonical Frostfang village material and painterly rendering reference. Redesign reference 1 into an exquisite crisp cinematic anime background painting matching reference 2's quality, NOT a screenshot or UI. The central square of Frostfang at gray-blue DAWN (no stars or aurora): heavy dark timber snow-roofed mountain village, stone foundations, icy flagstones, towering pale mountains, a handful of dim warm lanterns. Forty-three distinct living citizens are imprisoned upright in strict orderly rows under a thin translucent coating of frost and ice, their clothing and open eyes visible, NOT identical statues, not soldiers. Adult neighbors in practical winter layers, a flour-dusted baker and a teenage boy with balled fists in the nearer middle rows. Quiet oppressive stillness, no violence, no gore, no dynamic battle, no visible magic beams. Camera at human standing height with a slightly elevated view down the row aisles; arranged in the central 60% of the composition so a portrait phone center crop retains the rows and several legible faces. Keep foreground lower 20% as icy paving for the dialogue overlay added by the app. Clear depth separation, refined individual faces and clothing, detailed carved timber and hoarfrost. Rich painterly shading with crisp controlled edges, cold steel blue and muted charcoal with tiny amber lamp accents, atmospheric far distance but no blurry veil across the near citizens. No floating portraits, no hero character, no HUD, no text, no logo, no border. Preserve this scene's solemn human stakes and architectural consistency; output only the complete background painting.
