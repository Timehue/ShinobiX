# V27 Frostfang Story Trailer — Generation Record

## Mode

- Keyframes: built-in OpenAI image generation, reference-guided `illustration-story` mode.
- Motion: local FramePack image-to-video generation.
- Final edit: deterministic FFmpeg/Pillow renderer in `tools/trailer/render_trailer_v27.py`.

The supplied Rill avatar and the V25 Rill production anchor were strict identity references. Shipped Frostfang environments and the shipped Captain Yura / Kael Whitefang portraits controlled the canon character and world designs.

## Final project keyframes

| File | Production prompt summary |
| --- | --- |
| `tmp/trailer/cinematic-v27/001-rill-plate-v27.png` | Rill presses his wrist to Frostfang's intake plate; it projects someone long dead; Yura orders him to stop. Exactly two people, strict Rill/Yura identity, cold plate light against warm lanterns. |
| `tmp/trailer/cinematic-v27/002-kael-rescue-v27.png` | Kael carries one frostbitten shepherd home through a lethal whiteout. Exactly two people, strict Kael identity, exhausted heroism rather than villain framing. |
| `tmp/trailer/cinematic-v27/003-white-silence-v27.png` | Rill and Yura discover forty-three citizens preserved upright in frozen rows. Quiet institutional horror, stable foreground identities, no gore. |
| `tmp/trailer/cinematic-v27/004-yura-removes-mark-v27.png` | Yura removes her own translucent frost-script oath band while Rill witnesses rather than intervenes. Strict hands, wrist, identity and agency. |
| `tmp/trailer/cinematic-v27/005-rill-kael-meter-zero-v27.png` | Rill carries Dren's warm relay lantern into the vault; partially transformed Kael confronts him at the zeroed meter. The meter is the visual hinge. |
| `tmp/trailer/cinematic-v27/006-rill-protects-flame-v27.png` | Kael launches an ice wave; Rill wolf-steps around it while protecting the relay flame. Exactly two characters, one lantern, one wolf-chakra form, continuous vault geography. |

All six built-in generation prompts used a 16:9 cinematic anime keyframe target, strict reference roles, exact character-count constraints, preserved costumes/faces, anatomically correct visible hands, and explicit exclusions for duplicates, merged bodies, extra limbs, text, UI, watermarks, cyberpunk, photorealism and chibi redesigns.

## Motion prompts and settings

The exact accepted FramePack action prompts and deterministic seeds are stored in `tools/trailer/framepack_batch_v27.py`.

- Narrative shots: 37 frames each, 20 sampling steps, TeaCache enabled.
- Climax action: 73 frames / 2.43 seconds, 20 sampling steps, TeaCache enabled.
- Seeds: 27101–27106.
- Identity constraints: stable faces, costumes, hands, character count and environment geometry; no new people, duplicates, morphing or anatomy overlap.

## Editorial rejections

- Yura source frames after frame 10 were rejected because Rill's generated hand intruded on her decision. The final renderer uses only the first 11 clean frames, an extreme-left crop and a right-edge vignette.
- The action clip's late identity-drift tail is not held in the final edit; the source is retimed to the accepted action interval.
- No V25 or V26 still-pan story sequence is used.
