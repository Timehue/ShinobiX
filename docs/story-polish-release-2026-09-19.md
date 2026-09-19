# Story polish release

Prepared from main `090ee76b9ac590a36ae40d1eee89e0baab0643b2` in a separate checkout. This release includes the previously approved 40-item polish, five comparative patterns, the brass-token follow-up, and the six-item correction pass.

R01 through R04 were already restored on main. Their source, dialogue positions and approved labels were retained. W01 replaces Pike's neutral aftermath; W02 gives Toma two closing lines with one thank-you. All six are pinned by exact source and generated-payload assertions.

The earlier polish was transferred from its recorded replacements: 127 edits applied at their expected occurrence counts, and one token replacement was already present. Main's equivalent, more specific token caption and shortened repeated token reference were preserved. No unrelated local files were copied into this release.

The serialized comparison checks 145 approved fields. Of these, 143 changed from main and two already-correct token fields remain identical. All other values, keys, array lengths, dialogue positions, IDs, branch gates, destinations, rewards, artwork and interpolation tokens are unchanged.

Validation on this checkout:

- 84 focused tests passed, zero failures or skips. These include exact text, Dren's quotation, companion gates, rift testimony, epilogues, field routes, archive behavior, canonical authority and the narrative audit tests.
- Production `npm run build` passed server and client compilation, generated-content validation, distribution verification and size checks. Existing advisory build warnings remain; no budgets were changed.
- Production-build browser checks: 22 passed, zero failures, four intentional skips. The skips are desktop copies of relationship cases explicitly covered on mobile. Checks include all village openings, relationship repairs, finale/epilogue delivery, immutable archive/replay, canonical text over stale admin content, compatible saved artwork and the revised irrigation ending.
- Narrative audit: zero errors and 799 heuristic review warnings. No extra rewrite was performed in response to those warnings.
- `git diff --check` passed.

The browser checks used isolated fixture saves at desktop and mobile sizes. No real player progress was changed. These results describe local pre-push verification; GitHub CI and production rollout are separate checks.
