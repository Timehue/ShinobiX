import { STARTING_LIFE_POINTS } from "./chronicle-duel";

/* Four short pages instead of one. The single page left out Tributes, the
   first-player rule, FLIP, Calls, Shadow Doubles and Warded, which the Card
   Hall rules tab covers in full. */
export const TUTORIAL_PAGES: ReadonlyArray<{ title: string; lines: readonly string[] }> = [
  {
    title: "Your turn",
    lines: [
      `Start at ${STARTING_LIFE_POINTS.toLocaleString("en-US")} Health with a 40-card Deck and five cards. Draw, Standby, and End resolve automatically; you decide when to start or finish attacking during your Main Phases.`,
      "The first player skips its turn-one draw and cannot attack that turn.",
      "Smart Phase Assist finishes Battle automatically once none of your Monsters can attack. Switch it off in Match Options if you prefer every phase control.",
    ],
  },
  {
    title: "Summoning and Tributes",
    lines: [
      "Summon or Set one Monster per turn. Levels 1 to 4 need no Tribute, Levels 5 and 6 need one, and Levels 7 and 8 need two.",
      "A Set Monster enters face-down in Defense Position and can be Flip Summoned on a later turn. A FLIP effect triggers when the Monster is turned face-up.",
      "Fire beats Wind, then Lightning, Earth, Water and Fire again. Advantage adds +200 to the ATK or DEF used in battle.",
    ],
  },
  {
    title: "Calls, Shadow Doubles and Warded",
    lines: [
      "A Call Jutsu Summons its one matching Level 8 Monster from your hand in place of your Normal Summon. It costs 1,000 Health, and that Monster cannot attack on the turn it arrives.",
      "Shadow Clone makes two Shadow Doubles. You can Tribute them starting next turn, and they vanish when they leave the field.",
      "About half of the other Level 7 and 8 Monsters are Warded, and the card says so. Snares cannot destroy a Warded Monster or return it to the hand on the turn it is Summoned.",
    ],
  },
  {
    title: "Snares and battle previews",
    lines: [
      "A Set Snare waits one turn before it can answer a matching move. Guardian's Reversal can also counter a Snare that targets one of your Monsters.",
      "Target badges preview a battle from the stats you can see. A hidden Snare can still change the result.",
    ],
  },
];
