# Level 10–100 Progression Spine

This uses existing systems and does not claim the endgame is balanced.

| Milestone | Primary direction | Optional/social | Beta or gated note |
| --- | --- | --- | --- |
| 13 | Choose Healer, Vanguard, or Pet Tamer; continue missions/training | Pet and clan exploration | Choice is permanent; explain the role before confirmation |
| 15 | Genin rank; fill the four-jutsu loadout and continue core missions | PvP, pets, Card Clash | Advanced side modes are optional |
| 20 | XP is held for the Genin Exam; open Logbook and complete the shown requirements | Clan can wait | The hold is intentional, not a save bug |
| 30 | Chunin milestone; step into stronger missions and profession growth | Clan/PvP become more relevant | Do not imply war participation is required |
| 39 | XP is held for the Chunin Exam; Logbook points to the exam requirements | Join or found a clan; PvP optional | Low-population solo clan creation remains valid |
| 50 | Jonin milestone; prioritize A-rank missions, Jonin story, Towers, and profession mastery | Clan/village competition | Hollow Gate remains desktop-first; wars are staffed |
| 60–69 | Continue Towers, profession mastery, story, and A/S-rank preparation | Ranked PvP and clan goals | Weekly Boss contribution stays disabled until server-authoritative |
| 70–79 | S-rank missions and high-value story only where server settlement is safe | Clan Boss after certification | Client-trusted C/B/A/S mission payouts remain gated |
| 80–99 | Hollow Gate, Legacy, Towers, mastery, and veteran story goals | Special Jonin/Kage-related competition | Creator rewards and broad war seasons remain gated/staffed |
| 100 | Pursue Legacy completion, Tower records, profession mastery, clan/village leadership, and Kage-related story/competitive objectives | Seasonal ranked/war events | Level 100 is a long-term beta goal, not proof of full balance |

## Copy rules for existing guidance surfaces

- At 13: “Choose a profession. This permanent role changes your long-term activities; inspect all three before confirming.”
- At 15: “You reached Genin. Keep missions, training, and your loadout as the main path; social and competitive modes are optional.”
- At 20: “Your level is intentionally held for the Genin Exam. Open Logbook to see the exact requirements and where to go.”
- At 30: “You reached Chunin. Stronger missions and profession mastery are your main path; clans and PvP are optional.”
- At 39: “Your level is intentionally held for the Chunin Exam. Open Logbook; the hold lifts after the exam passes.”
- At 50: “You reached Jonin. Follow A-rank missions and Jonin story, then use Towers and profession mastery as repeatable goals.”

The current Logbook objective source already contains localized milestone and exam-hold language. Future changes should stay in `shinobij.client/src/lib/logbook-objectives.ts` and its tests rather than restructure screens.
