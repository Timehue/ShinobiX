# Performance release on current main — 2026-09-06

The release starts from live main `2d818ef81566f607988ba824263e38b1086600e3`. Before integration, GitHub CI, CodeQL, Production Image, and Post-deploy health all reported success for that commit. The public health endpoint also reported that exact commit with `ok: true`.

The original `codex/story` checkout had diverged substantially from main and held separate uncommitted story work. Only the performance changes were transferred into a clean main-based worktree. No merge of that old branch, unrelated story edits, generated story assets, package changes, or budget increases is part of this release.

## Retained improvements

- Shared concurrent admin-catalog reads, batched published content with fallback, and batched world-state, era, tower, clan-boss, and mercenary reads. Existing authoritative leases, locked rechecks, receipt validation, and compensation remain.
- Optional Postgres field projection for public roster and bloodlines; compatibility stores retain their normal routing. Partial reads never populate the full-save cache or become save-write input.
- The roster projection includes current main's independent `_regenAt` cursor as well as `_saveAt`, character, travel, and geography inputs. Its regression fixture has a recent save timestamp and older regeneration cursor, proving that unrelated writes cannot suppress displayed regeneration.
- Visibility-aware, non-overlapping tracked polls; a subscriber-owned display clock; on-demand archives; linear roster merging; stable AI-list derivation; and cancellation of retired roster/map requests.
- Mail reads share an initial/periodic lifecycle, cancel on navigation or mutation, and render only for their conversation. Nindo keeps text and banner in one local edit, while pristine state follows the server. Admin definition loads ignore retired responses and errors.
- Regression tests and reproducible synthetic byte/roster benchmarks are discovered by the normal test runners.

## Newer live code preserved

Main already has a revised setup-disengagement director, with its stricter all-casts separation test. Both remain unchanged. The older local retreat-priority adjustment is not applied.

Main's Warfront uses instanced projectile meshes, preallocated typed arrays, and an expanded staged scene. Its renderer, deployment controls, and effects remain unchanged; the older local scene-deletion/vector-reuse patch is superseded. Main's revised Chronicle preview harness is also retained.

The [gauntlet](PERFORMANCE_GAUNTLET_2026-09-06.md) and [follow-up](PERFORMANCE_FOLLOWUP_2026-09-06.md) describe historical development checkpoints, not evidence that the old checkout was pushed wholesale.

## Release verification

- Full `npm run test:ci`: **9,483/9,483 passed**, with zero failures, cancellations, or skips.
- Final immutable production-preview browser run: **10/10 passed** across desktop and mobile. Coverage includes slow mail requests, conversation changes and sending, Nindo text/banner save and clear, archive polling and repeated resource cleanup, and travel without redundant roster reads.
- `npm run build`: passed server and client TypeScript, story-content verification, Vite, distribution verification, and size gates. Initial JS/CSS is **384,565 bytes gzip** across 14 files; existing budgets remain unchanged.
- Full client lint: zero errors and ten pre-existing warnings in unchanged main files. The final changed-file lint check also passed without warnings.
- The mobile Nindo and guest-mail source contracts now match the implemented state and cancellable request shapes while retaining their accessibility and guest-access assertions. The 29 focused contract tests passed, and are also included in the full passing suite.
- WorldMap's cancellable guard reads use a small shared request helper, keeping the existing **5,365-line** gate intact.
- `git diff --check HEAD`: passed. Release scope was reviewed independently from the original dirty development checkout.

These are pre-push verification results. The remote commit and deployed health revision must be checked after publishing; a local build alone does not establish that production has changed.

## Browser-gate follow-up

The first pushed commit, `47d1129ea7a6179faf88d8cb70bf62852453b551`, passed GitHub's server contracts, client quality, production image, release certification, concurrency smoke, Village Stores, and all combat-layout gates. Two browser timing failures required a test-only follow-up:

- The existing QHD Warfront gate treated an `aria-hidden` role as a fully closed report, then relied on a 200ms sleep. Its trace showed the drawer still transitioning when control reachability was measured. The test now waits for the actual layer's hidden visibility and zero opacity before measuring. All accessibility, formation, reachability, and rematch assertions remain. **Six repeated exact-QHD cases passed**: three portrait and three landscape runs.
- The new archive lifecycle test's global fake clock stalled WebKit pointer stability checks. It now shortens only five-minute timers, preserving native rendering and pointer interactions. The test first proves recurring requests occur while open, verifies no requests across more than three poll intervals after closing, and confirms fetching resumes on reopen. **Fourteen cases passed**: two runs in each of the seven CI browser/device configurations, including Firefox and WebKit.

Both corrected specs pass lint. No production source, renderer, style, dependency, test threshold, or build budget changes accompany this follow-up. GitHub must rerun the release gates on the follow-up commit before production is considered verified.
