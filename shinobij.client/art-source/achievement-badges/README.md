# Level 10 achievement badge

- Master art: `level-10-rising-ember-crest-master.png` (1254 × 1254 PNG)
- Shipped web badge: `../../public/badges/level-10.webp` (256 × 256 WebP, Sharp quality 88)
- Rendered by the ID-based achievement image paths in Profile, UserView, and ToastStacksContent.
- The Google Play Games icon is derived from the same master at 512 × 512 with a circular transparent edge, mapped to `Genin Initiate` in `AchievementsIconsMappings.csv`; `python docs/play-games/verify-packages.py` verifies its mapping, size/transparency, and ZIP copy.

The former spiral forehead-band emblem was replaced with an original Rising Kite rank seal: nested angular kite facets around an amber gem, with crossed forged blades below. The new composition contains no forehead protector, spiral, village crest, text, or borrowed franchise symbol. The dark ember-red field, gold medallion frame, radial accents, and warm lighting keep the badge in the game's visual language.

Generation prompt: “Edit the supplied 512×512 round game achievement icon. Preserve its high-detail fantasy-game rendering, circular gold/brass ring, dark ember-red texture, warm orange-gold lighting, radial accents, and crossed forged blades. Completely remove the forehead protector/headband and central plate. Replace the focal area with a wholly original Rising Kite rank insignia: three nested angular kite/diamond facets around one small amber gem, with short rays readable at 64×64. Do not include any headband, forehead plate, face, spiral, swirl, leaf silhouette, village crest, character, text, letters, or recognizable franchise/trademark symbol. Keep the composition centered and crisp, with a strong small-size silhouette, no new border or crop, and no watermark.”

Run `node shinobij.client/scripts/derive-level10-achievement-assets.mjs` from the repository root after updating the master art, then regenerate the Play Games import bundle and run its verifier.
