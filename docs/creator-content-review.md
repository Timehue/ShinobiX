# Creator content review

Reviewed 2026-09-18, on top of the narrative integrity pass (`docs/narrative-integrity-review.md`, commit 13771806e). That pass could not read the live Creator rows. This review read all of them, audited them in full, checked how they reach players, and enforced the project's no-dash rule across player-facing narrative.

## Where Creator content lives

| Store | What it holds | How it reaches the game |
| --- | --- | --- |
| `kv_store` rows `save:admin1`, `save:admin2` | `creatorEvents`, `petEncounterVn`, `ancientChestVn`, `hollowGateEventConfig`, `creatorMissions`, `creatorRaids` (plus non-narrative catalogs) | Clients read both slots (`GET /api/save/admin1|admin2`) and merge them by id, admin2 last. The server projection and the client both drop every event that is not presentation-only (`isReleaseSafeCreatorEvent`, `isReleaseSafeClientEvent`), so rewards, battles, traits, finales and non-VN events reach admin accounts only. |
| `kv_store` rows `content:<field>` | The canonical published store (`api/_content-store.ts`) | Server catalogs read it as the last source. **Empty on 2026-09-18**: no `content:%` rows exist. |
| Player saves `save:<name>` | Mirrors of `creatorEvents` (84 saves) and of the two VN configs (146 saves) | Server-frozen (`ledger-toplevel`), filtered by the same release-safe rule on read. Same ids as the admin slots, no orphaned custom events. |
| `shared:img*` | Uploaded artwork, keyed by event and page | Overlaid onto the scene at render time. Independent of the rows' text. |

Reader path for custom scenes: `applySharedAdminContentSnapshot` → `creatorEvents` state → level trigger (no `trigger`), `firstBattleArena`, `firstLeaveVillage` (App) or a World Map marker for reward events → `TriggeredVisualNovel`. Reserved (built-in) ids are excluded from all three generic triggers and always render through `canonicalNarrativeEvent`, which keeps the repository's text, speakers and branches and borrows only artwork from a stored copy.

## Access method

Read-only `SELECT` queries against the production Supabase project through the owner's connected Supabase account (no credentials were handled or stored). The complete narrative fields of both slots were exported to a local file and checked field by field: per-event page counts, line counts and character counts, plus an MD5 of every event and config, all matched the database. Nothing was written to the database.

For future reviews there is now a supported, authenticated route that needs no database access:

```sh
SHINOBIX_BASE_URL=https://<host> ADMIN_TOKEN=<admin session token> npm run narrative:export-creator -- .tmp/creator-export.json
npm run narrative:audit -- --content .tmp/creator-export.json
```

`ADMIN_PASSWORD` works in place of `ADMIN_TOKEN` unless the server runs with `ADMIN_STRICT_TOKEN_ONLY=1`. The script issues the same admin `GET` the Admin Panel uses and keeps only narrative fields. The published store has no value-read route, so the script exports it as empty; that is accurate today, but a review must say so if the store is ever used.

## Inventory

| | Count |
| --- | --- |
| Stored `creatorEvents` rows | 46 (4 in admin1, 42 in admin2) |
| Distinct event ids | 42 (all four admin1 ids also exist in admin2) |
| System VN configs | 4 (`petEncounterVn` and `ancientChestVn` in each slot) |
| Effective entries after the runtime merge | 44 |
| Stale copies of built-in scenes | 43 (36 campaign chapters; awakening, aura sphere and hidden dungeon; pet encounter and ancient chest, each as an event row and as a config) |
| Custom events | 1, admin-only |
| Custom events visible to players | 0 |
| Creator missions / raids | 0 missions; 1 raid (admin-only, one generic description line) |
| Entries read in full | All 50 stored entries, every page and choice |
| Entries not accessible | None |

### The 43 built-in copies

Every one is the pre-rebuild draft of a scene that the repository has since rewritten. None of their text reaches players. Page counts differ sharply (3 stored pages against 4 to 26 current pages per chapter). What the drafts contain:

- **Retired canon.** The Hollow Gate as a hungry entity that feeds on chaos and "thanks" people for feeding it; a "Hollow Gate Pact" moving beneath villages; the player "chosen by the Frost Echo"; "Central's gates wake with our chakra"; Kages who literally fuel the Gate; ancestors burning a tree "in support of us". Current canon makes the Court/Gate a human-built extraction system run by officials.
- **Stale mechanics.** The awakening draft promises free Stone readings "at level 2 and level 20" and calls Central "the Thousand Gates".
- **Template lines reused across chapters and villages.** Examples: "The Hollow Gate Pact is moving beneath this village." "Watch what the village calls virtue; that is where corruption hides." "The pact was made to protect us." "Now prove your village deserves another future." Every Ashen Leaf and Frostfang chapter offers the same three choices ("Protect the people." "Demand the truth." "Move in secret.").
- **AI-fantasy lines.** "The ice remembers footsteps." "Friend against friend. Blade against promise." "That is tyranny with lightning around it." "Old roots. New blood. All will return to the first shape."
- **Attribution and continuity errors.** Kage pages whose speaker is "First Flame Avatar" or "Frost Seal Echo" while the lines are labelled "Kage". Sable is "he" and "she" inside one chapter. The chest draft's Narrator speaks in the first person ("...I wasn't expecting this.").
- **Typos.** "to late", "to old", "is generations", "better then mine", "no long sit by", "or years", "what is what true resolve is".

These rows are inert for text, so they were not rewritten. Rewriting them would create a second, competing version of each scene, which is what the canonical authority fix exists to prevent. The current versions of these scenes are the reviewed repository scenes.

### The custom event

`event-6ee8ea23-9dc5-40fd-a420-a6f17f6c0266` ("Ryo", admin2): a test placeholder. Its dialogue is "A strange chakra pressure fills the air." and "Admin Event: Test your strength, shinobi." It is a `reward` event in sector 20 with a 500,000 ryo reward. Because it is not a presentation-only VN, players never receive it; admin accounts see it as a sector marker and a Logbook entry. No player save has triggered it. It was not edited or deleted: it is live data and removing it is the owner's decision. The audit reports it as a `creator-placeholder` error until it is removed or replaced.

## Runtime authority and the Admin Panel

The canonical authority fix already kept stored copies away from players. The Admin Panel still listed the stored drafts as if they were the live story, and its hints said "Saving creates an editable imported copy" and "Players will see this scene when they find a pet", which stopped being true when repository text became authoritative. Now:

- `adminEditableNarrativeEvents` (`src/lib/canonical-narrative.ts`) lists each built-in exactly as players receive it (current text with any stored artwork merged in) and lists only genuinely custom events as custom. Stored rows are not modified or removed.
- The pet encounter and ancient chest editors, previews and "Load for Editing" use the same canonical view.
- Built-in scenes carry a hint that their text comes from the game files and only artwork changes reach players.

ID safety review:

- Every id the repository hands to the reader matches `isReservedNarrativeId` (`story-*` covers chapters, interludes, road events, epilogues and field scenes; plus rifts, craft dungeons, the three system events, both system configs and their old aliases, the Sage offer and the scribe).
- New Admin Panel events get `event-<uuid>` ids, so a new custom event cannot collide with a built-in.
- A stored event with a reserved id is excluded from all generic triggers and cannot replace built-in text, however it was published. A reserved id with no matching built-in never plays; the audit reports it.
- Duplicate ids silently resolve to the later source. The audit now reports duplicates within a source and different copies across sources.
- No id-safety bug was found beyond the Admin Panel display.

## Dash rule

Player-facing narrative must not use a dash as a pause. `dashPunctuation` (`scripts/narrative-audit.mts`) flags em, en, figure and horizontal-bar dashes, a minus sign that is not in front of a digit, double hyphens, spaced hyphens, and hyphens attached to a word as a pause or an interruption. Word hyphens (`first-clear`), suspended hyphens (`first- and second-rank`), negative numbers, a minus sign before a digit (`−12% Defense`), CSS custom properties and `${…}` template code are not flagged.

It is an **error** in `npm run narrative:audit` and in the regression test for:

- every scene and catalog entry in the narrative corpus: titles, captions, lines, choices and results;
- every prose literal in the supplemental narrative sources. This review added the Legacy trial speech and announcements, emissary, Sage and Legacy panel lines, wanderer dialog, Hunter Board and Chronicle rumors, the first-fight coach, Hollow Gate run narration and Spire boss blurbs;
- custom Creator scenes in any `--content` export.

Changes: 132 em dashes and 4 spaced hyphens removed from player-facing text in 36 files, each line rewritten in context rather than mechanically replaced. No en dash, figure dash or minus sign needed removal from narrative. `DASH_EXCEPTIONS` is empty.

Rewriting went beyond punctuation where a line was newly found to be opaque or off canon:

| Where | Before | After |
| --- | --- | --- |
| Sage, awakening trial | The path you chose has been carrying you. Now it asks you to carry it. This first trial is not a test of strength — it is the path learning the sound of your footsteps. | Choosing a path was the easy part. Now you earn it. This first trial is not about strength. It asks you to do this work again and again, where other people can see you do it. |
| Sage, awakening complete | It is done. The path has opened its eyes. From today it does not follow you — it walks beside you, and it has a name. | It is done. Your path is awakened. People have seen what you did, and they have started to call it by its name. |
| Sage, taijutsu | Flesh remembers what scrolls forget. Write this one in bruises. | Scrolls will not teach you this. Expect to take some hits. |
| Mythic Binding news | {player} has bound the {legacy} to their soul. Stage III — few will ever stand here. | {player} has completed the Binding of the {legacy}. Few shinobi ever reach Stage III. |
| Emissary, trial complete | Done, and witnessed. The path remembers. | Done, and witnessed. It's on the record now. |
| Hollow Gate augment | A boon stirs in the dark — choose one to shape this descent. Richer hauls demand greater risk; the shrine remembers what you take. | Choose one boon for this descent. The richer ones carry more risk, and the choice lasts for the rest of this run. |
| Card gambler | Come back when a scribe's put a codex in your pack — no sport in fleecing a man with nothing to play. | Come back when a scribe's put a codex in your pack. There's no sport in fleecing someone with nothing to play. |
| Hollow Gate lore | The first ward did not fail—it was opened. | The first ward did not fail. Someone opened it. |

The Legacy lines matter for canon: Legacies are witnessed deeds, and "bound to their soul" and "the path has opened its eyes" described them as a soul-bond or a living being.

### Spoken-aloud review of a random sample

The owner read 20 random dialogue pages (seed 20260918, picked from 779 conversation pages across the story families) and asked for one test: could an actor say this naturally? Lines that were already clear were left alone. The pages that failed were rewritten in context, without changing canon, meaning, ids, branches or gameplay:

| Scene | Problem | Now |
| --- | --- | --- |
| Mori, Ashen Leaf L92 | "cut futures" read as written, not spoken | "I never counted what the cuts took from people, or where it was sent." ("cuts" is the village's own word) |
| Lyra, Echoes floor 9 | One dense novelistic sentence | Three sentences she could say. "Acceptable variance" stays because it is her own margin note, set up two pages earlier. |
| Yura, Frostfang L25 | Choice button was narration ("The ice stands up.") | "Draw your weapon." |
| Nyx, ledger canal gate | Design-document shorthand ("Other route:", "cleaner custody", "Decide where they can hear you") | She explains both plans as a person would, and ends: "They're listening behind that shutter. Tell them what you decide." |
| Nyx, dyers' footbridge | Clipped three-beat lines ("No signature, no voice, no helpful silhouette…", "West bank. Casually.") | "See this smear in the wax? … They didn't sign it, and they didn't stay to explain." |
| Harrow, Moonshadow L80 | "surrendered trust" and a lore list delivered at the player | The Mirror holds "confessions and records of who trusted whom". The four owner-locked feedstock lines stay word for word, but she now reads them off the manifest. |
| Toma, east channel | "Next one slowly." twice in a row, and a Reed/reeds pun | The duplicate is gone and the plates are described plainly. |

Invented hyphenated compounds in the sample were kept only when they are established terms. "lantern-warden" (12 uses) and "warmth-token" (11 uses, a real item) stay. "not-coin" became "a blank brass token", "lamp-boy" became "the boy who lights the street lamps", "oath-keeper" became "the oldest elder", and "gate-fires" became "the fires at the village gate". The corpus has 249 distinct compounds, mostly ordinary English. Rare coinages outside the sample (for example "comfort-man", "out-talk", "veil-mother", "moth-mark") were listed for the owner and not changed.

Every edited page was snapshotted before and after for backdrop, scene family, variant, pose, shot and tone, and all of them matched. One first attempt flipped a page's scene family (the word "seal" is a sanctum keyword), so the wording was changed back to avoid it.

### What still contains a dash, and why

A repository-wide scan of every string literal in `shinobij.client/src`, `shared` and `api` still finds dash characters in about 1,800 literals across about 385 files. None is narrative prose covered by this rule:

- **UI, system and admin copy.** Hub and facility screens, clan and town hall panels, training, missions UI, legal pages, patch notes, and the Admin Panel. Examples: "Forge — 10 Dungeon Keys", "Unavailable — permanent village sector".
- **Combat and mechanics text.** Battle logs, pet battle simulation, PvP move logs, Spire modifiers, pet trait descriptions, and jutsu, bloodline and Legacy technique descriptions. `data/legacy-jutsu.ts` is mirrored by `api/pvp/_legacy-jutsu-catalog.ts`. These were left alone because the pass does not change jutsu or combat text.
- **Short labels in narrative files.** A trial-attempt header, a bounty hunter's display name, a Hall of Legends entry title, an API "busy" error, a Spire floor name, and an accessibility label that an e2e spec matches.
- **VN reader chrome.** Button labels such as "Leave — No Reward" were left because this pass does not change VN controls.
- **Code.** CSS class prefixes, custom properties, `calc(100% - 24px)`, numeric ranges in data, and quote attributions such as "— Player".

## QA tooling

- `npm run narrative:audit -- --content <export>` accepts the real multi-slot shape (`{slots: {admin1, admin2}, published}`), content-store records, `{creatorEvents}` or a bare array. It merges sources in runtime order and reports each entry as a stale built-in copy, a current built-in copy, a reserved id with no built-in, or custom. For custom entries it also reports whether players can see them.
- New checks:

| Code | Level |
| --- | --- |
| `dash-punctuation` | error |
| `retired-canon` (terms from the pre-rebuild drafts that current canon dropped) | error |
| `creator-placeholder` | error |
| `creator-invalid-id` | error |
| `creator-duplicate-id` | error |
| `creator-malformed` | error |
| `creator-reserved-id` | warning |
| `creator-shadowed-copy` | warning |
| `creator-stale-builtin` | warning |
| `creator-test-content` | warning |
| `narrator-first-person` | warning |

- Custom Creator scenes join the normal scene audit: missing speakers, empty text, unresolved variables, broken branches, unreachable pages, gated dead ends, repeated lines.
- `npm run narrative:export-creator` produces the export through the authenticated admin route.
- `node --import tsx scripts/gen-story-pdf.mjs [out.pdf]` now also renders the side stories (reckonings, field scenes, Hollow Rifts, Echoes of War) from the same inventory the audit checks, with each scene's backdrop and portraits. The PDF's own headings no longer use em dashes.

On the live export the audit reports 43 stale built-in copies (8 with retired lore), 1 admin-only custom event and 1 error (the placeholder). The repository corpus alone has 0 errors.

## Verification

- `scripts/narrative-audit.test.ts` covers:
  - dash rule cases, including legitimate hyphens;
  - no dash pauses in the corpus or the supplemental sources;
  - Creator export classification: stale copy with retired lore, current copy, shadowed copy, invalid id, reserved id with no built-in, placeholder, duplicate, visibility, published-store unwrapping, and a dash in a custom scene;
  - the export script keeping only narrative fields.
- `src/lib/canonical-narrative.test.ts` covers the Admin Panel listing, using the shape of the live Frostfang draft.
- `e2e/creator-content-runtime.spec.ts` serves verbatim live admin2 rows (`e2e/fixtures/creator-live-rows-2026-09-18.json`) to the production client and checks three things:
  - The stored Frostfang chapter draft does not replace the current chapter.
  - The stored awakening draft does not replace the current awakening scene when leaving the village.
  - A custom Creator VN still plays with narrator attribution, a named speaker, `%name` resolved and a working branch, while the live admin-only placeholder stays out of the player's Logbook.
  - Signed in as Admin 2, the Admin Panel lists the pet encounter, the ancient chest and the Frostfang chapter as players receive them, with the built-in hint, and does not offer the placeholder as a built-in.

## Old VN artwork

Before the rebuild, 244 VN page slots in `shared:img` held artwork drawn for the old drafts. The five Relic Dungeon entrance uploads (`event:craft-dungeon-<biome>:backdrop`) are from the same older set, and the dungeon screen showed them in place of each dungeon's cinematic entrance art. The 2026-09-18 identity cleanup had kept all 20 dungeon uploads as active dungeon art. On 2026-09-19 the owner approved retiring the five entrances, and [identity-cleanup-recheck.md](art-audit/identity-cleanup-recheck.md), `live-art-recheck.json` and `live-cleanup-manifest.json` record that change. A test (`scripts/retire-old-vn-images.test.ts`) keeps those records and the code list in agreement. The dungeons' warden, seal-two altar and rare-pet uploads have no built-in counterpart, so they are kept.

The game hides all of these. `lib/vn-retired-artwork.ts` lists each slot with the SHA-256 of its retired bytes. `useVnArtwork` (story pages) and `useVerifiedSharedArt` (the dungeon entrance) download a candidate and show it only when its bytes are proven new. A later upload to the same slot has different bytes and shows normally. Since 2026-09-19, a check that fails (timeout, server error, or a deleted upload returning 404) shows the built-in art. Before that it kept the stored link, so a failed check could show old art. Deleting the uploads under the old rule would also have left dead links on 12 pages, because the stored draft rows still point at these slots: the Frostfang level 4 chapter, the Aura Sphere scene and the ancient chest.

`scripts/retire-old-vn-images.mts` removes those uploads from storage, so they cannot resurface through any path that skips the filter:

```sh
SHINOBIX_BASE_URL=https://<host> node --import tsx scripts/retire-old-vn-images.mts             # dry run, read-only
SHINOBIX_BASE_URL=https://<host> ADMIN_TOKEN=<token> node --import tsx scripts/retire-old-vn-images.mts --apply
SHINOBIX_BASE_URL=https://<host> ADMIN_TOKEN=<token> node --import tsx scripts/retire-old-vn-images.mts --restore <backup dir>
```

It covers the 244 page slots, the 5 dungeon entrances, and 4 draft event avatars, which qualify only if their bytes equal a retired portrait (253 slots). Each slot is downloaded and hashed first, and deleted only if its current bytes still equal the retired hash. Every slot it will delete is backed up beside a `manifest.json` before anything is removed. Deletion goes through the app's own `DELETE /api/images`, which clears R2, the per-image key, the legacy category bundle, the asset registry and the cache version. A direct database delete would not be enough, because `/api/img` rebuilds a missing key from the legacy bundles. After each delete the script reads the slot back and counts it only if it now returns 404.

The dry run against production on 2026-09-18 found 248 slots to retire, 0 newer uploads and 0 missing, with a 6.2 MB backup. That was before the 5 dungeon entrances were added. Run the cleanup only after the fail-closed check is live, and the `--apply` step is the owner's to run.

## Remaining decisions for the owner

- Delete or replace the "Ryo" test event in admin2 (Admin Panel, Events tab, Delete).
- The 43 stored drafts are harmless but misleading in raw data. Leaving them is safe. Deleting a built-in's stored copy in the Admin Panel reverts it to the plain built-in; artwork uploaded through the gallery stays in `shared:img*`, but row-only art references on the pet and chest configs would be dropped.
- The published `content:*` store is empty. If it is adopted, extend the export route so reviews can read it.
- Run the old-artwork cleanup with `--apply` (see "Old VN artwork").
- Rare hyphenated coinages outside the reviewed sample: "comfort-man", "out-talk", "veil-mother", "moth-mark", "pen-drag", "riot-stopper", "first-stupidest". Keep them if they are meant as world terms; otherwise they can be rewritten in plain words.
