# World Cohesion — how the three pillars connect

> Written 2026-07-23. One page of canon so story (combat), pets, and the
> Shinobi Chronicle card game read as one world instead of three modes. All of
> this is voiced through the **ambient layer** (tavern gossip, wanderers,
> emissaries, guides, generated card lore) — the story VN files
> (`data/storylines.ts`, `story-interludes.ts`, `story-epilogues.ts`) are
> LOCKED and are never edited for this.

## The canon (say it in one line)

**Combat makes the deed; companions witness it; the Chronicle preserves it; a
Legacy is the pattern a shinobi chooses to repeat.**

The Hollow Gate is not an ancient creature or portal. People of the Sunken
Court built it as part of a civic optimizer meant to end famine, war, and
winter. The **Ancients** were the people of that era. The **Withheld** were the
Ancients who refused cession when the Court tried to extract and regularize a
defining choice. Their resistance left one hundred recognizable action
patterns: the **one hundred Legacies**, represented by the hundred glyphs.

A Legacy is never a Bloodline, soul, reincarnation, ancestor, or person living
inside a descendant. It is a pattern repeated freely in action and confirmed
by witnesses. The Sage and emissaries recognize patterns; they do not choose a
person's fate or install a Legacy.

The Chronicle **predates the villages**. Its first scribes recorded people,
beasts, places, and choices during the Sunken Court's final age, especially the
deeds the Court's edited records would otherwise erase. It remains a **living
record**: it grows and changes as the world does ("A Kage falls, we press the
card. Your beast makes a name on the sand, we press that too. The Chronicle
doesn't close."). A card is a portable record, never a trapped soul or the
living being itself. The archive-burning explanation remains the villages'
plainest modern reason for distributing that record: you cannot burn what is
kept in everyone's pockets. The **traveler's codex**, the 40-card teaching set,
was traditionally handed to every academy graduate; the wars broke the
tradition, so scribes like Ihara now deliver it on the road.

- **Story combat creates the evidence.** Under pressure, the player makes the
  mercy, refusal, ambition, endurance, or other choice that can repeat a
  Legacy's pattern. The unclassifiable player is not chosen by the Gate.
- **Companions are living witnesses.** A bonded beast shares the road, reacts
  to the player's choices, and can prove its own character in pet battles. The
  Coliseum is where a beast earns a name; Chronicle scribes watch the sand.
- **The Chronicle preserves the evidence.** Every card depicts something real:
  story bosses (`monsterFromStory`, "Kage / Hollow" and "Story Combatant"
  families), Legacy patterns (`monsterFromLegacy`, "Legacy Pattern"), wild
  beasts and shinobi (tile cards), even the Wandering Sage himself. A Chronicle
  Showdown is two collectors arguing history with portable records.
- **The Legacy system interprets the evidence.** The Hall of Legends carves
  witnessed names and deeds in stone; the Chronicle distributes them on paper;
  the Sage and eight emissaries compare a shinobi's repeated choices to the
  hundred patterns. The final choice still belongs to the player.

The catalog builds Chronicle entries from story bosses, all one hundred Legacy
patterns, the Wandering Sage, and five fixed Living Witness companion records.
Server settlement grants them from verified deeds only; cohesion copy must
describe those entries as records, not as beings or souls contained in cards.

## Where the canon is voiced (the wired surfaces)

| Surface | File | What it carries |
|---|---|---|
| Tavern gossip strip | `shinobij.client/src/lib/legacy-rumors.ts` `TAVERN_GOSSIP` | The canon line itself, scribes printing Hollow Kage, coliseum beasts "earning their card" |
| Legacy rumors (pre-50) | same file, `RUMORS` | Concrete human rumors; beats 3–5 sight the emissaries and the Sage as real people |
| Road wanderers | `shinobij.client/src/lib/wanderers.ts` | Gambler carries a Chronicle deck; tracker points hunts at your beast |
| Legacy emissaries | `shinobij.client/src/lib/legacy-emissaries.ts` | Kesshi: scribes + odds = history; Hollow Warden: saw the first Kage turn; Ojii: coliseum beast earning its card |
| Mode guides | `shinobij.client/src/data/guides.ts` | Coliseum = where sector breeds prove themselves; Chronicle = the villages' answer to the Hollow |
| Generated card lore | `shared/chronicle-duel.ts` `monsterLoreFromSource`, `monsterFromLegacy`, `storyLoreFor` | Mechanical tile-card copy becomes witnessed field lore; Legacy cards record patterns; story-boss cards stay diegetic and never use level/chapter meta |
| Chronicle Scribe event | `shinobij.client/src/lib/chronicle-scribe.ts` + `api/card-clash/claim-starter.ts` | One-time roaming NPC (Scribe Ihara, level 17+): teaches the card game in-fiction and hands over the traveler's codex (the existing starter floor, delivered with ceremony) |
| Card-game lock | `shinobij.client/src/lib/chronicle-lock.ts` + `api/card-clash/_starter-cards.ts` `chronicleUnlocked` | The Chronicle is SEALED until Ihara's codex: Card Hall + Shop packs locked client-side; AI duels, PvP queue join, and both pack endpoints gated server-side. World-embedded card encounters (dungeon tiles via externalStakes, clan war tilecards, sector-card) stay open so nothing dead-ends |

## Dialogue voice rules (the humanization contract)

The 2026-07 pass replaced "AI riddle" voice with human voice. Keep it that way:

1. **A rumor is SPOKEN TO the player, not narrated.** First/second person,
   contractions, plain words: one concrete fact plus a human reaction ("weird,
   right?", "I didn't love that part"). Attribute to ordinary people — barkeep,
   bounty clerk, smith, kennel master. Never personify abstractions (no
   horizons learning names, no shadows taking notes), never narrator-voice
   cleverness or scene jargon ("the rail", "down forty hands") — if a line
   needs a second read on a phone, it fails.
2. **One aphorism per character is personality; five is AI.** Named emissaries
   keep at most one koan-ish line each; the rest are war stories, brags, and
   dry jokes.
3. **Tone bible** (from `docs/sector-wanderers-content.md`): terse, weathered,
   a little mythic. Humor is dry. Threats are quiet. Nobody over-explains.
   Contractions are allowed — people use them.
4. **The mystery rule still holds** for Legacy rumors: never stats, never
   mechanics, only people talking.
5. **Card lore is diegetic.** No "Level X chapter", no "enters the Chronicle"
   roster copy (a test bans it: `ChronicleCardView.test.ts`). The card talks
   about the world, not about being a card.
6. **No real-world TCG references** anywhere in player-facing text.

## Open threads

- ~~`data/pet-pool.ts` wild species have no descriptions~~ **DONE 2026-07-24**
  (branch `claude/trusting-burnell-c8d458`): every one of the 140 species has a
  one-line field-note description in the contract voice, stamped from the
  `wildPetFlavor` map in pet-pool.ts and backfilled onto already-owned pets by
  `normalizePetTemplate`. A handful nod at the coliseum/Chronicle canon.
  Guarded by `data/pet-pool.test.ts`; note `api/pet/_catalog.ts` is a generated
  mirror and must be regenerated on any pet-pool field change.
- ~~Card Hall has no diegetic intro copy~~ **DONE 2026-07-24** (this worktree):
  `.chronicle-scribe-note` under the hall header — "The scribes will tell you
  straight: our archives kept burning. So we print the history on cards now —
  you can't burn ten thousand pockets."
- ~~The three modes had no durable shared progression receipt~~ **DONE
  2026-08-11** (this worktree): verified story clears press their exact boss
  record; ten authoritative arena wins let the participating companion establish
  a fixed Living Witness record; Chronicle wins feed the Legacy activity record;
  Sage acceptance and Awakening press the Sage and matching Legacy records.
  Every grant is server-derived, exact-once, response-replayable, excluded from
  packs, and presented through Ihara's receipt ceremonies.
