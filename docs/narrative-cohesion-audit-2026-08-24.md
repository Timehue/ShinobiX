# Narrative Cohesion Audit

Date: 2026-08-24

## Scope

This pass reviewed every authored, story-bearing surface in the current game path: the four village campaigns, road events, interludes, reckonings, epilogues, intro cinematic, visual-novel events, Hollow Gate scenes, Hollow rifts, missions, Quest Book epics, wanderers, clan halls, shrines, Legacy Sage scenes, emissaries, rumors, Chronicle Scribe pages, Era events, Sunscar Festival dialogue, Tower chapter framing, world-map lore, and the server copies or generated catalogs that feed those experiences.

Player-authored text, administrative copy, and purely tactical labels were not treated as authored narration. Combat descriptions were reviewed when they made a lore claim, particularly claims about the Hollow Gate, the Sunken Court, or Legacy.

## Shared Story Spine

- The Sunken Court was a human civilization. Its people built the lattice now called the Hollow Gate to stabilize civic life.
- The Hollow Gate is infrastructure, not a hungry monster, spirit, portal, or god. It measures human choices and converts instability into repeatable patterns.
- The Ancients were people. The Withheld refused the Court's demand to surrender human choice to the machine.
- A Legacy is a witnessed pattern of action preserved in records and repeated by another shinobi. It is not a soul, reincarnation, bloodline memory, or chosen-one inheritance.
- Stormveil tests whether public reasons survive the challenge board and arena.
- Ashen Leaf tests whether a living future can grow beyond promises preserved in the Branch Register.
- Frostfang tests whether mutual survival can leave room for a person to depart.
- Moonshadow tests whether trust remains trust when secrets become property and receipts become leverage.
- The central question across all four campaigns is who gets to decide what a person's promise means.

## Voice Standard

- Characters speak from a concrete need, memory, mistake, fear, duty, or opinion.
- Dialogue favors plain speech, contractions, physical observations, and specific shinobi work.
- A scene should normally contain one concrete fact and one human reaction before it offers philosophy.
- Characters do not narrate themselves in the third person or deliver disconnected slogans.
- Mystical language must describe an observable chakra effect, technique, record, seal, route, or action.
- Story copy avoids raw game terminology, Earth-specific card-game language, generic fantasy vocabulary, and stock riddle prose.
- Authored story copy uses no em dashes or en dashes.

## Continuity Safeguards

- `shinobij.client/src/data/story-tone-and-staging.test.ts` scans the live narrative corpus for retired labels, raw game language, stock artificial mysticism, dash punctuation, and non-human rift dialogue.
- `api/_legacy-defs.test.ts` protects all Sage-facing Legacy records from slogan writing, personified abstractions, and game-stat jokes.
- Tower tests protect the human-built Court framing and concrete shinobi situations.
- Intro-cinematic tests protect the human origin of the Gate, its measuring function, the player's lack of predestination, and the companion's agency.
- Server and client Quest Book catalogs remain exact copies so the story cannot drift between briefing and runtime.
- Generated village story assets are rebuilt from source and checked for drift before builds.

## Outcome

The four main campaigns already carried the strongest character work. This pass brought the surrounding systems into the same world: side events now sound like reports, requests, arguments, and memories spoken by people who live there. The Hollow Gate, Legacy, village institutions, and the Sunken Court now keep the same meaning from the opening cinematic through endgame systems.
