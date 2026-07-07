# Mission Difficulty Bands

Mission catalogs should declare eligibility matching these bands. The server-side helper in `api/missions/_eligibility.ts` is the enforcement point for generated and claimed missions.

| Band | Level Range | Rank Feel | Mission Examples | Required Metadata |
| --- | ---: | --- | --- | --- |
| Academy | 1-9 | Tutorial | Academy Trial, first combat drill, simple field sweep | `minLevel: 1`; no PvP, ranked, clan, pet, or endgame systems |
| Genin | 10-24 | Early | D/C work, light hunts, PvP intro | `minLevel: 10` for PvP/ranked-flavored tasks; use `requiresPvpUnlocked` or `requiresRankedUnlocked` |
| Chunin | 25-49 | Mid | B missions, moderate hunts, early clan/village objectives | `minLevel: 25+`; clan tasks require `requiresClan`; village tasks require `requiresVillage` |
| Jonin | 50-69 | Advanced | A missions, harder hunts, advanced dungeons | `minLevel: 50+`; higher reward missions need explicit level gates |
| Elite Jonin | 70-99 | High | S missions, war prep, apex hunts | `minLevel: 70+`; war/clan boss tasks require their system gates |
| Endgame | 100 | Capstone | Hollow Gate Warden, Legacy trials, top bosses | `minLevel: 100` plus exact system unlock, for example `requiresHollowGateUnlocked` or `requiresLegacyUnlocked` |

Hard rules:

- Hollow Gate Warden, Hollow Gate deep-run, keeper, or endgame shrine text requires `minLevel: 100` and `requiresHollowGateUnlocked: true`.
- Legacy or mythic objective text requires `minLevel: 100` and `requiresLegacyUnlocked: true`.
- Clan Boss objectives require clan membership, clan boss access, and a meaningful level floor.
- Village War objectives require village membership and village-war access.
- Ranked objectives require ranked access and at least the Genin/PvP band.
- Pet training requires a pet; expedition objectives require expedition access.
- A mission that cannot declare its gates must not be paid by the server catalog.
