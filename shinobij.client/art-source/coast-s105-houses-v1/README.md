# The Stair Houses and the four coast foes

Eight original paintings made with ImageGen for sector 105 and the remaining four coast opponents. The lossless PNG masters are in `masters/`. [Prompts and visual references](prompts.json) · [Runtime files, sizes and SHA-256 hashes](delivery.json)

The existing sector floor, Record House interior and entry painting supplied the lighting, materials and overhead view. The settlement sprite and entry show nine cedar houses climbing the same stair. The hanging cook pot identifies the communal kitchen in both. The outdoor floor combines the new clearing and the painted cluster with the existing sector painting so its four road mouths stay aligned. Three pale doorpost patches carry the family-record detail into the entry picture.

The Unmoored Patrol and Courier share the bandit-2 world model. The patrol carries a sheathed sword and heavier armor. The courier carries scroll tubes and a sealed dispatch satchel. The Hushcrown Guard follows the underground patrol's teal tabard, mask, topknot and spear. Runner's Lookout follows the world bandit's rust headband, leather shoulder, face wrap and knife. The pass captain and quay warden supplied the coast's portrait finish.

The four lossless character paintings retain their original waist-up framing. The runtime exporter crops each around the head and chest so the face and identifying kit remain legible in the 36 px phone combat frame.

From the worktree root, run `node shinobij.client/art-source/coast-s105-houses-v1/export.cjs <output-directory>` with the project's pinned Sharp dependency. The encoder reads the original public `coast-map/s105.webp` for the exterior and writes all eight WebPs under the supplied directory. The game uses the versioned replacement floor. [Walkable sector and room layout](../../../output/coast/saltstair-landing/layouts.json)
