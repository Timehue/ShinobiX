# Pet Colosseum integration and resource lifecycle audit

## Issues corrected

- Seven particle systems constructed new typed arrays in JSX on ordinary UI updates. Replacing their attached attributes orphaned uploaded WebGL buffers. They now own one memoized geometry per particle budget, retain its attributes until disposal, and reuse its position buffer during animation. This covers stage weather, crowd confetti, set-piece clouds, climate, mechanic accents, the charge orb and elemental residue.
- The installed Drei Sparkles implementation also constructs a new color attribute for string colors on each render. The arena now passes a stable typed color array through its supported API. Particle density, color and motion remain the same.
- The older rock-eruption and lightning-bolt meshes received externally constructed geometries through props. Those resources now have explicit disposal. Arena floor/backdrop, crowd-dot and fallback-fighter textures also have explicit cleanup. Shared asset caches remain shared; fighter disposal continues to preserve shared GLTF geometry and atlas maps.
- Temporary effect-removal timers survived battle exit. Beat timers and effect-removal timers now have separate scopes: advancing a beat cancels its delayed impacts, effect fades survive that transition, and closing the battle clears both scopes. Executed handles are removed from the sets immediately.
- A late turn response can no longer restart an unmounted battle's presentation. Navigating away during matchmaking/model warmup no longer reactivates fullscreen. A successfully created server session retains its resume breadcrumb.
- Spectator auto-advance now respects failed orders and expired sessions, preventing a failed submission from repeatedly rescheduling itself. Manual retry remains available.

## Integration checks

The actual server engine remains the source of combat results. All 945 equipped move slots across 160 pets pass the real-command presentation checks on both teams in 1v1, 2v2 and 3v3. These include unique within-loadout presentations, primary versus splash targeting, Guard/Protect/absorption/dodge, reserve switches, ranged Frost Shatter and the five elemental area effects. Ultimate first-charge, later-charge, serialization, damage pacing and existing role/element/species balance bands also pass. This cleanup pass does not change combat tuning.

The wider suite exposed an outdated source assertion expecting the first array entry to be the melee victim. It now checks the resolved primary target and excludes splash, matching the existing behavioral integration tests.

**246 tests pass.** Server/client type checks, production bundling, distribution verification, scoped lint and size checks pass. Budgeted product JS/CSS is 8,195,286 bytes, below the enforced limit. The existing bundle-size warning remains. The lifecycle instrumentation and review harness are absent from the production JavaScript.

## Browser measurement

The development harness's `lifecycle` option tracks WebGL handle creation/deletion/context loss and pending application timers, intervals and animation frames. It holds handle membership in weak sets and records counts rather than retaining GPU objects. The harness poll is excluded from application timer counts. `Play review`/`Pause review` preserve the same mounted battle in this mode, allowing comparisons after effects settle. `Unmount battle` and `Restart battle` exercise real component teardown. `failturn` injects a refused spectator submission.

Before the particle fix, a single warmed fire review grew from **692 to 1,057 live buffers**, while textures stayed at 43 and programs at 33. This was continuing allocation, not merely a larger initial scene. Early growth after the fix must still allow for the authored, capped arena scars and first-use texture/shader uploads; comparisons use settled states after warmup.

The final fire test ran **41 review rounds**. Between settled rounds 33 and 41 in the same WebGL context, buffers stayed at **310**, programs at **24**, and vertex arrays at **157**. Texture uploads rose from 42 to 43 as another cached flipbook frame was first displayed. The earlier 28-buffer rise between rounds 3 and 13 was exactly seven additional four-buffer arena decals, ending at the Cinematic cap of ten scars; it did not continue with each UI update.

Performance, Balanced and Cinematic changes each retired the previous context. After closing the final fire battle, **all four created contexts had been lost/released**, all tracked GPU handle counts were zero, and pending battle timers, intervals and animation callbacks were zero. Two blizzard restarts each retired their previous context while the pooled area-effect renderer continued to work. The final teardown samples are in the raw report.

Refused spectator submissions remained at **one attempt**, with a visible `Playback paused` alert and `Retry playback` button. One manual retry raised the count to **two**, where it stayed with zero pending retry timers. Closing the failed review also returned every GPU handle and scheduled-work count to zero. Neither browser test page reported runtime console errors.

Raw browser samples are in `pet-colosseum-lifecycle-samples-2026-09-09.json`. GPU handle counts are not a measurement of driver VRAM bytes, and sampled JavaScript heap sizes include reusable asset caches and garbage-collection timing. This audit verifies the observed browser paths; it is not a guarantee for every device/driver or an indefinite soak. Browser checks use the production renderer; the animation suite separately tests Strict Mode-style resource reactivation.

Build/test logs: `output/showdown-lifecycle-production-build.log`, `output/showdown-lifecycle-final-tests.log`, `output/showdown-lifecycle-qa-build.log`.

Changes are local and have not been deployed.
