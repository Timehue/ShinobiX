/** Research-only artifacts for the December 2003 USA TCG translation.
 * Kept outside the runtime duel module so reference identities never ship in
 * the player-facing card catalog or consume the production bundle budget. */
const row = (
  role: string,
  referenceCards: string,
  chronicleCardIds: string,
) => ({
  role,
  referenceCards: referenceCards.split("|"),
  chronicleCardIds: chronicleCardIds.split("|"),
});

export const CHRONICLE_US_2002_2003_ROLE_AUDIT = Object.freeze([
  row(
    "draw and hand velocity",
    "Pot of Greed|Graceful Charity",
    "chronicle-recon-scroll|chronicle-stacked-scrolls|chronicle-crimson-insight|chronicle-chakra-ledger|chronicle-forbidden-archive",
  ),
  row(
    "Monster revival",
    "Monster Reborn|Premature Burial|Call of the Haunted",
    "chronicle-revival-scroll|chronicle-deathless-recall|chronicle-second-wind-recall|chronicle-grave-lantern-rite|chronicle-ancestral-muster",
  ),
  row(
    "Monster removal",
    "Raigeki|Dark Hole|Fissure|Tribute to The Doomed",
    "chronicle-giant-felling-edict|chronicle-hollow-breach|chronicle-executioners-mandate|chronicle-rift-cleaving-script",
  ),
  row(
    "Magic and Trap removal",
    "Mystical Space Typhoon|Heavy Storm|De-Spell",
    "chronicle-sealbreak-verdict|chronicle-hundredfold-tempest|chronicle-cleansing-radiance|chronicle-shrine-purge|chronicle-storm-shear",
  ),
  row(
    "position and tempo control",
    "Book of Moon|Compulsory Evacuation Device",
    "chronicle-moonfold-genjutsu|chronicle-mirage-displacement|chronicle-recall-seal|chronicle-whirlwind-dismissal|chronicle-kage-exile-command|chronicle-hall-of-mirrors",
  ),
  row(
    "Equip and battle reinforcement",
    "Axe of Despair|United We Stand|Mage Power|Reinforcements",
    "chronicle-tempered-kunai|chronicle-saints-edge|chronicle-final-bulwark|chronicle-bannerlords-rally|chronicle-flame-tempered-blade|chronicle-stormforged-senbon|chronicle-stoneplate-harness|chronicle-tideguard-mantle|chronicle-foxfire-feint|chronicle-iron-root-stance",
  ),
  row(
    "elemental Field environments",
    "Umi|Mountain|Wasteland|Sogen|Forest",
    "chronicle-field-volcano|chronicle-field-ocean|chronicle-field-desert|chronicle-field-sky|chronicle-field-lightning-storm",
  ),
  row(
    "attack declaration response",
    "Mirror Force|Magic Cylinder|Waboku|Widespread Ruin|Reinforcements|Castle Walls",
    "chronicle-smoke-bomb|chronicle-substitution-log|chronicle-explosive-tag|chronicle-mirror-shell-counter|chronicle-returning-cylinder-seal|chronicle-substitution-mirror|chronicle-wall-of-smoke|chronicle-widespread-kunai-line|chronicle-stone-clone-barrier|chronicle-ringed-detonation|chronicle-long-watch|chronicle-reapers-toll|chronicle-palm-ward|chronicle-ashen-veil|chronicle-floodgate-mist|chronicle-sand-coffin-counter|chronicle-gale-reversal|chronicle-thunder-cage|chronicle-moonshadow-slip|chronicle-ironwood-bulwark|chronicle-tidal-deflection|chronicle-cinder-minefield|chronicle-avalanche-seal|chronicle-scorpion-wire|chronicle-skyhook-snare",
  ),
  row(
    "summon response",
    "Trap Hole|Bottomless Trap Hole|Torrential Tribute|Horn of Heaven",
    "chronicle-sealing-circle|chronicle-pitfall-tag-array|chronicle-abyssal-pitfall|chronicle-torrential-tag-field|chronicle-gatekeepers-rebuke|chronicle-final-trial-binding|chronicle-hearthfire-expulsion|chronicle-earthen-grave-array|chronicle-flash-burial-tag|chronicle-great-maw-seal|chronicle-heavenfall-verdict|chronicle-undertow-gate|chronicle-dust-exile|chronicle-vacuum-prison",
  ),
  row(
    "Magic activation counter",
    "Magic Jammer|Magic Drain|Solemn Judgment|Imperial Order",
    "chronicle-kage-judgment-seal|chronicle-chakra-jammer|chronicle-counter-script-cache|chronicle-imperial-silence-ward|chronicle-still-water-rebuttal|chronicle-sovereigns-decree|chronicle-ember-cipher|chronicle-drowned-formula|chronicle-grounding-rod-script|chronicle-windless-edict|chronicle-mirror-moon-rebuttal|chronicle-kage-archive-lock|chronicle-five-seal-denial",
  ),
]);

export const CHRONICLE_NOVEMBER_2003_LIST_AUDIT = Object.freeze({
  effectiveDate: "2003-11-17",
  forbidden: Object.freeze([] as string[]),
  limited: Object.freeze(
    "Breaker the Magical Warrior|Cyber Jar|Exodia the Forbidden One|Exiled Force|Fiber Jar|Injection Fairy Lily|Jinzo|Left Arm of the Forbidden One|Left Leg of the Forbidden One|Morphing Jar|Right Arm of the Forbidden One|Right Leg of the Forbidden One|Sangan|Sinister Serpent|Twin-Headed Behemoth|Tribe-Infecting Virus|Witch of the Black Forest|Yata-Garasu|Card Destruction|Change of Heart|Confiscation|Dark Hole|Delinquent Duo|Graceful Charity|Harpie's Feather Duster|Heavy Storm|Mage Power|Mirage of Nightmare|Monster Reborn|Painful Choice|Pot of Greed|Premature Burial|Raigeki|Snatch Steal|Swords of Revealing Light|The Forceful Sentry|United We Stand|Upstart Goblin|Call of the Haunted|Ceasefire|Imperial Order|Magic Cylinder|Mirror Force|Reckless Greed|Ring of Destruction".split(
      "|",
    ),
  ),
  semiLimited: Object.freeze(
    "Marauding Captain|Morphing Jar #2|Creature Swap|Nobleman of Crossout|Reinforcement of the Army|Last Turn".split(
      "|",
    ),
  ),
});

const adoption = (
  category: "monster" | "magic" | "trap",
  role: string,
  referenceCards: string,
  chronicleCardIds: string,
  november2003Status:
    | "limited"
    | "semi-limited"
    | "unlimited"
    | "mixed",
) => ({
  category,
  role,
  referenceCards: referenceCards.split("|"),
  chronicleCardIds: chronicleCardIds.split("|"),
  november2003Status,
});

/** Popular, period-legal effect roles selected after comparing the Chronicle
 * pool with the 2003 World Championship lists and the Dark Crisis card pool.
 * These are gameplay translations only; no Yu-Gi-Oh! identity ships in the
 * runtime catalog. */
export const CHRONICLE_DECEMBER_2003_POPULAR_EFFECT_AUDIT = Object.freeze([
  adoption(
    "monster",
    "FLIP Monster removal",
    "Man-Eater Bug",
    "tc-08",
    "unlimited",
  ),
  adoption(
    "monster",
    "FLIP Magic recovery",
    "Magician of Faith",
    "tc-33",
    "unlimited",
  ),
  adoption(
    "monster",
    "battle-damage hand disruption",
    "Don Zaloog|White Magical Hat",
    "tc-31",
    "unlimited",
  ),
  adoption(
    "monster",
    "battle-destroyed recruiter",
    "Mystic Tomato|Sangan",
    "tc-20",
    "mixed",
  ),
  adoption(
    "monster",
    "continuous Trap suppression",
    "Jinzo",
    "tc-50",
    "limited",
  ),
  adoption(
    "monster",
    "post-battle dimensional displacement",
    "D.D. Warrior Lady",
    "tc-44",
    "unlimited",
  ),
  adoption(
    "monster",
    "Normal Summon position disruption",
    "Tsukuyomi",
    "tc-39",
    "unlimited",
  ),
  adoption(
    "monster",
    "reflected damage when attacked",
    "Reflect Bounder",
    "tc-63",
    "unlimited",
  ),
  adoption(
    "magic",
    "one-sided Monster sweep",
    "Raigeki",
    "chronicle-giant-felling-edict",
    "limited",
  ),
  adoption(
    "magic",
    "symmetrical Monster sweep",
    "Dark Hole",
    "chronicle-executioners-mandate",
    "limited",
  ),
  adoption(
    "magic",
    "one-sided Magic and Trap sweep",
    "Harpie's Feather Duster",
    "chronicle-hundredfold-tempest",
    "limited",
  ),
  adoption(
    "magic",
    "symmetrical Magic and Trap sweep",
    "Heavy Storm",
    "chronicle-storm-shear",
    "limited",
  ),
  adoption(
    "trap",
    "attack-position formation punishment",
    "Mirror Force",
    "chronicle-mirror-shell-counter",
    "limited",
  ),
  adoption(
    "trap",
    "attack negation and reflected damage",
    "Magic Cylinder",
    "chronicle-returning-cylinder-seal",
    "limited",
  ),
  adoption(
    "trap",
    "summon-triggered field wipe",
    "Torrential Tribute",
    "chronicle-torrential-tag-field",
    "unlimited",
  ),
  adoption(
    "trap",
    "Monster destruction and symmetrical damage",
    "Ring of Destruction",
    "chronicle-ringed-detonation",
    "limited",
  ),
]);

export const CHRONICLE_DECEMBER_2003_EXCLUDED_EFFECTS = Object.freeze([
  {
    referenceCards: Object.freeze(["Yata-Garasu"]),
    reason:
      "Turn-skipping lock patterns remove counterplay and do not fit the intended duel pacing.",
  },
  {
    referenceCards: Object.freeze(["Fiber Jar", "Cyber Jar"]),
    reason:
      "Full hidden-zone resets create excessive variance and erase the field-state strategy the five elements are built around.",
  },
  {
    referenceCards: Object.freeze(["Exodia the Forbidden One", "Final Countdown", "Last Turn"]),
    reason:
      "Alternate-win packages require dedicated deck construction and rules surfaces outside this launch pool.",
  },
  {
    referenceCards: Object.freeze([
      "Confiscation",
      "Delinquent Duo",
      "The Forceful Sentry",
    ]),
    reason:
      "Unconditional opening-hand attacks are excluded; combat-earned discard remains interactive.",
  },
  {
    referenceCards: Object.freeze(["Vampire Lord"]),
    reason:
      "Delayed self-revival after effect destruction needs a visible pending-effect rules surface before it can be added cleanly.",
  },
  {
    referenceCards: Object.freeze(["Skill Drain"]),
    reason:
      "Blanket Monster-effect negation would erase too much of the deliberately limited 23% Effect Monster roster.",
  },
]);
