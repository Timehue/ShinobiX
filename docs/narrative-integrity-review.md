# Narrative integrity review

Reviewed September 18–19, 2026. This report records the repository content pass, runtime authority fixes, editorial review and validation evidence. The machine-readable inventory and all random-review selections are in [narrative-integrity-evidence.json](narrative-integrity-evidence.json).

Release integration note: the user subsequently requested publication to live main. The release is based on `e594ca60408cc7f76ac7ba3e158b6dc54b1d141e`, preserves main's newer image-category hydration and cwd-independent test paths, and includes the [narrator portrait follow-up](first-pact-portrait-fix.md). Live main already has an 8,700,000-byte total build ceiling, so the local budget adjustment described below is not part of the release diff. Results below describe the original workspace review; release checks are run again on the integrated checkout before pushing.

The requested handoff is a content, continuity, and narrative-loading pass. Story traits, rewards, chapter indices, gameplay gates, artwork, and VN presentation stay intact. Existing unrelated checkout changes are recorded in `.tmp/narrative-baseline-status.txt` and must be preserved.

## Runtime source map

| Authored source | Delivery to the player | Status / duplication |
| --- | --- | --- |
| `src/data/storylines.ts`, `story-interludes.ts` | `scripts/generate-story-content.mts` -> hashed village JSON / manifest -> `story-content-loader` -> `story-trigger` -> App -> `TriggeredVisualNovel`; Story Hall archive uses the same payload | Live. Generated JSON must be regenerated, never edited by hand. Fixed App's whole-event override: saved copies now supply matching artwork through `canonical-narrative.ts`; current prose and branches come from the generated payload. |
| `src/data/story-epilogues.ts` | Generated village epilogue JSON -> epilogue loader/selector -> pending narrative delivery -> reader | Live, selected by ending and saved traits. |
| `src/data/story-road-events.ts` | Generated road JSON -> road content loader -> WorldMap wanderer -> event converter -> reader | Live, includes level and village conditions. |
| `src/data/story-reckonings.ts`, `story-field-scenes.ts` | Generated field JSON -> field loader -> WorldMap accept, field points, turn-in, aftermath | Live, includes old-save aftermath paths. Server `shared/story-field-work.ts` and `api/sector` own gates and rewards. |
| `src/data/hollow-rifts.ts` AND `src/lib/hollow-rifts.ts` | WorldMap giver / descent / repeat event; pending first-clear reaction delivered through `use-story-delivery` | Both live. Main tone tests read data intros/descent but omit helper-authored repeat and completion dialogue. Senna's reported line is in the latter. |
| `src/data/echoes-of-war-scenes.ts`, `echoes-of-war.ts`, `lib/echoes-witness-scenes.ts` | Generated Echoes JSON -> Echoes loader -> EchoesOfWar pre-fight, defeat, victory, rematch, era and witness events | Live, multiple conditional deliveries. |
| `src/data/vn-events.ts`, `default-vn-events.ts`, `lib/pet-encounter-vn.ts`, `pet-tutorial.ts` | App tutorial triggers / WorldMap discovery / dungeon events -> reader | Live defaults; built-in tutorial, chest, pet and dungeon delivery now keep current prose while accepting matching saved artwork. |
| `features/intro-cinematic/introCinematicScript.ts` | IntroCinematic -> village / companion variants | Live, separate renderer. |
| `lib/academy-narrative.ts`, `screens/first-pact/narrative.ts`, FirstPact, `shared/first-pact-contract.ts` | Academy and companion quest screens | Live, separate from story chapters. |
| `lib/wanderers.ts`, `shared/wanderer-roster.ts`, `lib/contract-hunter-wanderers.ts`, `legacy-emissaries.ts`, `legacy-rumors.ts`, `legacy-sage-vn.ts`, `chronicle-scribe.ts` | WorldMap, Legacy and Chronicle interaction routes | Live; "legacy" means the current deed-pattern system, not dead code. |
| `lib/questbook.ts`, `data/missions.ts`, server quest / mission catalogs | Quest Book, Missions and NPC task interactions | Live. Mirrored catalogs need parity checks. |
| `data/hollow-gate-flavor.ts`, `lib/hollow-gate-presentation.ts`, tower catalogs, `api/_era-defs.ts`, clan lore, shrines, Sunscar | Mode-specific text / event responses | Live, prose outside VN objects needs separate review. |
| `creatorEvents`, `petEncounterVn`, `ancientChestVn`, gate configs in shared admin content | Legacy admin1/admin2 save slots + published content store -> content snapshots -> App / WorldMap | Built-in IDs use current repository prose and compatible saved art. External custom scenes remain supported; unknown live rows require an authenticated export for review. |
| `shared/chronicle-duel.ts`, tile/Legacy/pet-witness card sources; pet pool; starter/event items | Chronicle catalog builder -> card views; pet and inventory descriptions | Rendered card lore, species descriptions and item inscriptions reviewed. Server pet descriptions mirror the client pool; Chronicle Legacy descriptions now have a parity test. |
| `src/generated/story-content` | Generated assets imported by manifest URLs | Required build products, not duplicate authoring sources. |
| Historical story docs / PDF and art generators / preview catalogs | Documentation, development previews | Not player narrative sources. Do not remove history or live Legacy content on filename assumptions. |

Paths beginning `src/` above are under `shinobij.client/`. SQL/schema searches found no standalone seeded story-dialogue catalog. Shared content is stored as data through the API storage/content layer rather than a separate story table.

## Confirmed failure causes

- The earlier broad tone gates check banned words and punctuation, not whether a conversation makes literal sense. A sentence can pass all gates while communicating almost nothing.
- `lib/hollow-rifts.ts` stores additional live dialogue outside the data corpus imported by the main tone test.
- The campaign trigger previously replaced the entire generated event with a matching saved admin event. Old dialogue and graph data could therefore win over revised repository prose. The new canonical authority helper prevents this.
- Generated copies, alternate paths, repeat visits, first-clear reactions, and narration require their own coverage; a filename scan is insufficient.
- First Pact appended narrated companion actions under the speaking NPC's label. It now switches to Narrator for those actions.
- Three Chronicle Legacy descriptions had drifted from authoritative deed records. The browser copies are synchronized and protected by a parity test.

## Context and voice constraints

Current implementation and the creative canon in `story-bible.md` establish the Court/Gate as a human-built civic extraction system. Legacies are repeatable witnessed deeds, never inherited souls. Preserve ambiguous origins of the player's missing mission and level-70 reveals.

- Mira: practical rigger, lively and blunt; jokes about specific situations; mother's loss is personal, not a stream of weather proverbs.
- Toma: warm, stubborn, protective of Aren's plans; family and craft vocabulary with concrete meanings.
- Yura: concise orders with practical reasons; concern emerges through rescue work. Her decision to remove her mark must remain her own.
- Sova: experienced keeper, careful and protective; explains procedures clearly, with growing doubt about their cost.
- Nyx: quick, guarded, transactional humor; gradually speaks without bargaining when she trusts the player.
- Harrow: exact about evidence, payment, and responsibility; distinguishes witnessed facts from reports.
- Senna: patient grave keeper; explains inscriptions and care for the dead in ordinary speech, without inventing missing identities.
- Kages: distinct reasons for defending their systems; coercion stays intelligible rather than becoming generic villain riddles.

## Reviewed scope

Read all four campaigns and interludes in level order, including alternate choices and conclusions; all road events, reckonings, field routes, historical-save aftermath and epilogues; all rift introductions, descents, revisits and first-clear reactions; and every Echoes phase and witness alternative. Secondary review covered tutorials, intro/Academy variants, First Pact, wanderers, Legacy interactions, quests, missions, mode briefings, Sunscar outcomes and lore catalogs.

The source inventory distinguishes executed builders from source extracts used to inspect embedded copy. It does not claim every possible saved character state was executed in a browser. Four rounds of complete-entry random review and representative mounted-reader tests are detailed below.

## Evidence and continuity notes

- Senna sends the player to recover the inscription of a Withheld person's refusal, after stopping a Gate-made copy. Descent shows three surviving symbols (hand, gate, witness). Their individual grammar is not established, so the rewrite must not invent a meaning for each symbol. The recovered rubbing preserves an already-established deed while the person's identity remains unknown.
- Sova's intake is registration for the Count and precedes the mark plate. There is no established pulse examination in this scene. The handoff's suggested medical line is an example of clarity, not new canon to insert.
- Rift fixes: removed animal noises from the empty kennel, kept Sann's explanation at the waystation instead of teleporting to the arena, corrected Nemo's question/answer about the first face he saw, and made abandonment conclusions describe what the player can observe rather than NPC reactions to news they have not received.
- Frostfang fixes: the L25 rescue now keeps the already-thawed soldiers out of the ice in combat conclusions; the L42 intervention describes witnessed loss of anger rather than physically holding doubt; L50 no longer has Kael answer that nonexistent action; Yura's hunter is not assigned an unexplained erased identity; the burned forgery plate is a drawing in its later callback; L100 no longer quotes an unspoken claim that Kael read a report four times or invents a second secret nineteen-minute test.
- Regression checks use real chapter data, stale typed `lines`, stale branches, actor-bound artwork, old system aliases, reserved-ID trigger guards, and serialized dungeon recovery. Prose assertions were updated to preserve their factual requirements instead of pinning replaced wording.
- Canonical authority covers App campaign/interlude selection, both built-in tutorial triggers, default/recovered/crafted dungeon selection, and WorldMap pet/chest delivery. Generic saved-event triggers now exclude reserved IDs. This removes alternate runtime delivery of old built-in scenes without deleting storage history or custom creator events.
- Archive inspection confirmed that saved choice receipts contain IDs and positions, not dialogue. Replays and decision summaries resolve current text from the canonical payload. Keep page/choice order and IDs stable during prose editing.
- Anonymous GETs to both public-facing admin content slot URLs returned HTTP 401. No external rows were read or modified. Authenticated custom creator content remains an explicit verification limitation; the audit accepts a local export for those rows. Built-in events are protected even when those unknown rows contain older built-in copies.
- The four campaign passes retained page and choice positions, trait IDs, battle and reward data. Ashen Leaf's broken-chain sequence, original-model/reconstruction references, and branch-dependent claims were corrected. Moonshadow now distinguishes archive originals, sold paper copies, and Mirror-held claims; Sable's scheduled Mirror transfer no longer appears to be caused by the return of the papers.
- Side-story corrections include Mori referring to the player's actual Register entry, Yura no longer claiming the player never took the Count oath, callbacks naming the actual notes/lesson choices, and the Provision Nine objection using the Narrator for narrated actions instead of the Player portrait.
- Epilogues were read across every outcome and proof variant. Fixed the accidental cross-village Jorun work crew, his twenty-/forty-year contradiction, the original Aren model being called a reconstruction, and repeated claims that mechanical anchors cost nothing. Consequences still distinguish voluntary alternatives from heat, shelter, and oversight they cannot replace.
- Echoes review covered all ten opponents' intro/defeat/victory/rematch scenes, four era intros, all witness choices and records, battle callbacks, following-era replies, Halden acknowledgements, and landing/encounter copy. Simplified match replies, removed claims of current village intake activity that could be false after a finale, and kept the Gate's harmful acts distinct from the officials' deliberate cover-up.

## Meaningful changes

Paths beginning `src/` or `e2e/` in this section are relative to `shinobij.client/`. These are the narrative changes from this pass, not a claim of authorship for the other work already present in the checkout.

| Area | Sources changed and purpose |
| --- | --- |
| Main story and consequences | `src/data/storylines.ts`, `story-interludes.ts`, `story-road-events.ts`, `story-reckonings.ts`, `story-field-scenes.ts`, `story-epilogues.ts`: rewrite unclear exchanges in context, repair knowledge/timeline contradictions, clarify choices and narration. |
| Rifts and Echoes | `src/data/hollow-rifts.ts`, `src/lib/hollow-rifts.ts`, `src/data/echoes-of-war-scenes.ts`, `echoes-of-war.ts`: repair instructions, witness testimony, repeat/completion reactions and canon distinctions. |
| Secondary dialogue | `src/data/vn-events.ts`, `src/lib/pet-tutorial.ts`, `legacy-emissaries.ts`, `wanderers.ts`, `src/components/OnboardingCoach.tsx`, and embedded `src/screens/WorldMap.tsx` responses: clarify tutorial instructions, ordinary NPC interactions and task results. |
| Rendered lore | `api/_era-defs.ts`, `api/_legacy-defs.ts`, `shared/legacy-card-sources.ts`, `shared/pet-witness-card-sources.ts`, `shared/tile-cards.ts`, `src/data/event-items.ts`, `src/data/pet-pool.ts`, `api/pet/_catalog.ts`: replace opaque descriptions and keep client/server records consistent. Card and pet mechanics are unchanged by these text edits. |
| Runtime authority | New `src/lib/canonical-narrative.ts` and its tests; integration in `src/App.tsx`, `src/screens/WorldMap.tsx`, `src/lib/dungeon-presentation.ts`: current repository text and graph remain authoritative for built-ins while compatible saved artwork survives. Dungeon recovery uses the existing asynchronous presentation loader. |
| Speaker attribution | `src/screens/first-pact/narrative.ts`, `src/screens/FirstPact.tsx`, and `src/lib/first-pact-narrative.test.ts`: mark where appended narration begins and display it under Narrator. |
| Developer QA | New `scripts/narrative-corpus.mts`, `scripts/narrative-audit.mts`, `scripts/narrative-audit.test.ts`; root `package.json` command; semantic updates to existing narrative regression assertions. |
| Browser verification | New `e2e/narrative-integrity.spec.ts`; First Pact narration assertion in `e2e/first-pact-rpg.spec.ts`; existing `e2e/story-presentation.spec.ts` exercises mounted readers and archives. |
| Generated delivery | Regenerated story-content manifests and eleven replacement hashed JSON assets. Removed the eleven superseded hashed payloads through the generator. |
| Build accounting | `scripts/check-build-size.mjs`: total product JS/CSS ceiling adjustment, measured and disclosed below. |

A serialized comparison against the original versions of eight core authoring modules found 486 changed prose fields, one intentional Player-to-Narrator correction, and one additional Halden prose value stored under a choice key. Arrays count as fields in this comparison, so this is not a count of individual sentences. All other serialized values in those modules match: page and choice positions, gate/trait IDs, levels, opponents, rewards and artwork. The full comparison is retained in the evidence JSON.

## Before and after

These examples were repaired with their preceding information, alternate choices and later callbacks in view.

**Sova, Frostfang intake**

Before: “Wrist here. If you feel faint, sit down. The brazier is behind you.”

After: “Hold out your wrist. This is where your rescue mark will go. If you're light-headed from the cold, sit beside the brazier first.”

The procedure is marking the wrist. A pulse examination would have added unsupported action.

**Senna, recovered inscription**

Before: “Open hand. Closed gate. Witness mark. The rubbing survived clean enough to read.”

After: “You kept it clear. I can make out the hand, the gate, and the witness mark. Together, they're the record of a person refusing the Court, just as I remembered.”

Her next line explains what remains unknown: “We still don't have their name. But now we have a copy of what they did, even if the stone wears away. Tell me what you saw at the shrine while I write it down.”

**Mira, cable crossing**

Before: “Take the brake. I want to check the span under my own weight this time. If I say slack, you know what slack means now.”

After: “Take the brake. I want to check the span under my own weight this time. If I ask for slack, ease the line out slowly. Keep it locked until then.”

The player now receives an actionable instruction without an assumed lesson.

**Toma, Aren's file**

Before: “Here. Aren Reed. My brother. Read it. Nothing is missing from it. That's what I need you to understand first.”

After: “Here. Aren Reed, my brother. There aren't any gaps in the dates. If you didn't know him, you'd think this was his whole life.”

This establishes why an apparently complete official record can still misrepresent Aren.

**Daigo, trial briefing**

Before: “Your trial is counted in bruises the record keeper may miss. Bring the tally back; I will inspect what the page leaves out.”

After: “Bring your fight tally back when the trial is done. I want to hear where you struggled, too. The record keeper only counts the wins.”

The concern is now concrete and fits a mentor asking about the experience behind a score.

## Obsolete content and duplicate paths

Removed the whole-event override that let saved built-in scenes replace current campaign text, speakers and branches. Reserved built-in IDs can no longer re-enter through generic saved-event triggers. Built-in tutorial, dungeon, pet and chest delivery also resolves current content first. Saved artwork is matched to compatible pages and actors rather than granting old event objects authority over the story.

Regeneration removed eleven obsolete hashed payloads and updated their manifest references. The generated directory remains a delivery product of the authoring modules. Three stale browser Legacy descriptions were replaced with their authoritative deed records and now have a parity regression test.

No database rows were deleted. Custom creator scenes and historical development documents were retained because they are not proven obsolete built-in runtime content. The live Legacy system was retained. Archives preserve their existing IDs and positions and resolve displayed prose from the current payload.

## Narrative audit and editorial QA

Run from the repository root:

```sh
npm run narrative:audit
npm run narrative:audit -- --sample 26 --seed 20260922
npm run narrative:audit -- --content local-admin-export.json
npm run check:story-content
```

The audit imports real builders and authored data. Its inventory contains **601 entries in 22 families: 409 scene variants and 192 catalog entries**, with **3,122 dialogue/instruction lines, 848 narration lines and 2,230 catalog text/label fields**. Alternatives and repeat variants are counted separately; these are not unique lines seen by one player. Another 30 source files provide 1,004 prose extracts for contextual review of embedded copy. Those extracts are review aids, not additional executed scenes.

Structural checks cover duplicate IDs, empty text and speakers, placeholders and unresolved variables, typed-line consistency, invalid branch references, conflicting gates, unreachable pages, closed branches and gated dead ends. Style checks flag short lines, punctuation, potentially stale canon terms and substantial repeated lines for human review. They do not rewrite text or equate short speech with bad speech. Local admin exports are read only. All tooling runs during development, with no browser dependency added.

The final audit reports **zero structural/content errors** and **810 editorial advisories**: 676 short-text findings, 35 punctuation findings, 31 canon-term findings and 68 repeated-line findings. Review found legitimate catalog labels, brief reactions, interrupted speech, explicit denials of inherited-soul lore, and shared material across conditional variants. These remain visible as review prompts; suppressing them would imply a precision the heuristic does not have. Coherence and character voice were assessed through complete-scene reading, not inferred from an error count.

Four seeded rounds sampled 26 complete entries each, stratified across every family and all four villages: **104 reads, 89 distinct entries**. Every selected entry was read with all its pages, choices and results. Seeds are reproducibility keys, not review dates.

| Seed | Review result |
| --- | --- |
| 20260919 | Found a Moonshadow L25 claim that depended on an optional trace; Nyx now proposes the trace. Clarified dungeon Showdown and party-tutorial instructions. |
| 20260920 | No further incoherent exchanges found; checked intentional memory-loss repetition and conditional witness callbacks. |
| 20260921 | Corrected “Return to the The Hollowed Name” and a missing question mark in Toma's channel scene. |
| 20260922 | No further incoherent exchanges found, including the complete Frostfang finale and its alternatives. |

The evidence JSON records every sampled ID, the inventory, findings and structural comparison. The final adjacent catalog pass additionally reviewed complete rendered card lore, pet and item descriptions; that review is separate from the random-scene count.

## Runtime and build verification

Tests used the actual production-built client served locally with deterministic API fixtures. The Frostfang test deliberately supplied an old shared-admin copy with obsolete dialogue, typed lines and a corrupt next-page target. It verified the admin response and generated story request occurred, the revised Sova dialogue rendered, and the selected canonical branch continued. Senna's pending first-clear receipt rendered the revised testimony under Senna. First Pact's companion actions rendered under Narrator and survived reload.

Existing mounted-reader journeys covered all four village openings through combat result, completion, archive and replay; an Ashen Leaf finale through its personal consequence and epilogue; all four relationship repairs; and pending-choice/account ownership behavior. Desktop screenshots were visually checked for Sova, Senna and First Pact attribution.

| Validation | Result |
| --- | --- |
| Full repository test suite after core prose/runtime changes | **11,307 / 11,307 passed** |
| Focused audit/story-content/tone/rift checks after final scene corrections and formatting | **41 / 41 passed** |
| Final catalog, pet parity, Chronicle, pet-witness and audit checks | **73 / 73 passed** |
| Production-client desktop browser journeys | **10 passed**, four intentionally mobile-only cases skipped |
| Production-client mobile browser journeys | **14 passed** |
| Final production build, generated-content consistency, distribution and size checks | **Passed** |

The full suite preceded the final small catalog edits; the relevant 73 checks and final production build ran after those edits. This is not a claim that the entire suite was rerun after every wording change.

Build accounting required a disclosed adjustment: the integrated product exceeded its previous 8,600,000-byte JS/CSS ceiling. A controlled build using the same current runtime but the original prose from eight core modules measured 8,623,555 bytes, slightly larger than the revised-prose comparison build. Cutting dialogue therefore would not resolve that overage. The total ceiling is now 8,700,000 bytes, following the existing 100 KB integration allowance. Startup, compression, chunk, CSS and story-route ceilings were unchanged. This is a budget adjustment, not a performance optimization.

The final build measures **8,623,340 bytes** of product JS/CSS. Its initial graph is **1,431,074 bytes raw / 384,596 bytes gzip**. The build still emits the total-size warning below its hard failure ceiling.

Final artifact assertions confirmed that the built JS/JSON contains the revised Sova and Senna dialogue and synchronized Legacy/pet descriptions, contains neither reported bad dialogue example, and matches the saved audit summary. The generated-content check and narrative audit were also rerun successfully after the last build.

Detailed local logs are `.tmp/narrative-full-tests-final.log`, `.tmp/narrative-final-focused.log`, `.tmp/narrative-catalog-final-tests.log`, `.tmp/narrative-runtime.log`, `.tmp/narrative-runtime-mobile.log` and `.tmp/narrative-build-final-verified.log`. Aggregate evidence and sample selections are retained in the report's companion JSON; temporary logs and screenshots remain local artifacts.

## Remaining limits

- External custom creator scenes could not be inspected: both anonymous admin-slot requests returned 401. No authenticated export was available. Built-in scenes are protected from stale copies, and `--content` supports auditing a future authorized export; arbitrary custom scenes are not certified by this review.
- Browser verification covered representative production-client journeys with fixtures, not every possible save-state combination or a live production account. The source review and graph audit cover the broader repository corpus. Service-worker cache behavior was outside the fixture runs.
- These changes are local and have not been deployed. Production configuration and deployment checks remain part of the normal release process.
- Editorial quality cannot be guaranteed by a word filter. The retained complete-scene sampler and contextual warnings make future review repeatable; they do not replace reading new dialogue in its scene.
