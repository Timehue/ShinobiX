/** Research-only artifacts documenting Founding Codex role coverage.
 * Kept outside the runtime duel module so nothing here ships in the
 * player-facing card catalog or consumes the production bundle budget.
 * Every entry maps a gameplay ROLE to the original Chronicle cards that
 * fill it — no external card identities are recorded here. */
const row = (role: string, chronicleCardIds: string) => ({
  role,
  chronicleCardIds: chronicleCardIds.split("|"),
});

export const CHRONICLE_FOUNDING_ROLE_AUDIT = Object.freeze([
  row(
    "draw and hand velocity",
    "chronicle-recon-scroll|chronicle-stacked-scrolls|chronicle-crimson-insight|chronicle-chakra-ledger|chronicle-forbidden-archive",
  ),
  row(
    "Monster revival",
    "chronicle-revival-scroll|chronicle-deathless-recall|chronicle-second-wind-recall|chronicle-grave-lantern-rite|chronicle-ancestral-muster",
  ),
  row(
    "Monster removal",
    "chronicle-giant-felling-edict|chronicle-hollow-breach|chronicle-executioners-mandate|chronicle-rift-cleaving-script",
  ),
  row(
    "Jutsu and Snare removal",
    "chronicle-sealbreak-verdict|chronicle-hundredfold-tempest|chronicle-cleansing-radiance|chronicle-shrine-purge|chronicle-storm-shear",
  ),
  row(
    "position and tempo control",
    "chronicle-moonfold-genjutsu|chronicle-mirage-displacement|chronicle-recall-seal|chronicle-whirlwind-dismissal|chronicle-kage-exile-command|chronicle-hall-of-mirrors",
  ),
  row(
    "Equip and battle reinforcement",
    "chronicle-tempered-kunai|chronicle-saints-edge|chronicle-final-bulwark|chronicle-bannerlords-rally|chronicle-flame-tempered-blade|chronicle-stormforged-senbon|chronicle-stoneplate-harness|chronicle-tideguard-mantle|chronicle-foxfire-feint|chronicle-iron-root-stance",
  ),
  row(
    "elemental Field environments",
    "chronicle-field-volcano|chronicle-field-ocean|chronicle-field-desert|chronicle-field-sky|chronicle-field-lightning-storm",
  ),
  row(
    "attack declaration response",
    "chronicle-smoke-bomb|chronicle-substitution-log|chronicle-explosive-tag|chronicle-mirror-shell-counter|chronicle-returning-cylinder-seal|chronicle-substitution-mirror|chronicle-wall-of-smoke|chronicle-widespread-kunai-line|chronicle-stone-clone-barrier|chronicle-ringed-detonation|chronicle-long-watch|chronicle-reapers-toll|chronicle-palm-ward|chronicle-ashen-veil|chronicle-floodgate-mist|chronicle-sand-coffin-counter|chronicle-gale-reversal|chronicle-thunder-cage|chronicle-moonshadow-slip|chronicle-ironwood-bulwark|chronicle-tidal-deflection|chronicle-cinder-minefield|chronicle-avalanche-seal|chronicle-scorpion-wire|chronicle-skyhook-snare",
  ),
  row(
    "summon response",
    "chronicle-sealing-circle|chronicle-pitfall-tag-array|chronicle-abyssal-pitfall|chronicle-torrential-tag-field|chronicle-gatekeepers-rebuke|chronicle-final-trial-binding|chronicle-hearthfire-expulsion|chronicle-earthen-grave-array|chronicle-flash-burial-tag|chronicle-great-maw-seal|chronicle-heavenfall-verdict|chronicle-undertow-gate|chronicle-dust-exile|chronicle-vacuum-prison",
  ),
  row(
    "Jutsu activation counter",
    "chronicle-kage-judgment-seal|chronicle-chakra-jammer|chronicle-counter-script-cache|chronicle-imperial-silence-ward|chronicle-still-water-rebuttal|chronicle-sovereigns-decree|chronicle-ember-cipher|chronicle-drowned-formula|chronicle-grounding-rod-script|chronicle-windless-edict|chronicle-mirror-moon-rebuttal|chronicle-kage-archive-lock|chronicle-five-seal-denial",
  ),
]);

const adoption = (
  category: "monster" | "magic" | "trap",
  role: string,
  chronicleCardIds: string,
  copyRule: "limited" | "semi-limited" | "unlimited" | "mixed",
) => ({
  category,
  role,
  chronicleCardIds: chronicleCardIds.split("|"),
  copyRule,
});

/** Popular, format-legal effect roles selected while balancing the Chronicle
 * pool for role coverage. These are gameplay translations only; no external
 * card identity is recorded or ships in the runtime catalog. */
export const CHRONICLE_FOUNDING_EFFECT_AUDIT = Object.freeze([
  adoption("monster", "FLIP Monster removal", "tc-08", "unlimited"),
  adoption("monster", "FLIP Jutsu recovery", "tc-33", "unlimited"),
  adoption("monster", "battle-damage hand disruption", "tc-31", "unlimited"),
  adoption("monster", "battle-destroyed recruiter", "tc-20", "mixed"),
  adoption("monster", "continuous Snare suppression", "tc-50", "limited"),
  adoption(
    "monster",
    "post-battle dimensional displacement",
    "tc-44",
    "unlimited",
  ),
  adoption(
    "monster",
    "Normal Summon position disruption",
    "tc-39",
    "unlimited",
  ),
  adoption("monster", "reflected damage when attacked", "tc-63", "unlimited"),
  adoption(
    "magic",
    "one-sided Monster sweep",
    "chronicle-giant-felling-edict",
    "limited",
  ),
  adoption(
    "magic",
    "symmetrical Monster sweep",
    "chronicle-executioners-mandate",
    "limited",
  ),
  adoption(
    "magic",
    "one-sided Jutsu and Snare sweep",
    "chronicle-hundredfold-tempest",
    "limited",
  ),
  adoption(
    "magic",
    "symmetrical Jutsu and Snare sweep",
    "chronicle-storm-shear",
    "limited",
  ),
  adoption(
    "trap",
    "attack-position formation punishment",
    "chronicle-mirror-shell-counter",
    "limited",
  ),
  adoption(
    "trap",
    "attack negation and reflected damage",
    "chronicle-returning-cylinder-seal",
    "limited",
  ),
  adoption(
    "trap",
    "summon-triggered field wipe",
    "chronicle-torrential-tag-field",
    "unlimited",
  ),
  adoption(
    "trap",
    "Monster destruction and symmetrical damage",
    "chronicle-ringed-detonation",
    "limited",
  ),
]);

/** Effect PATTERNS deliberately kept out of the Founding Codex pool, described
 * by the mechanic they represent (no external card identities). */
export const CHRONICLE_FOUNDING_EXCLUDED_EFFECTS = Object.freeze([
  {
    pattern: "turn-skipping lock",
    reason:
      "Turn-skipping lock patterns remove counterplay and do not fit the intended duel pacing.",
  },
  {
    pattern: "full hidden-zone reset",
    reason:
      "Full hidden-zone resets create excessive variance and erase the field-state strategy the five elements are built around.",
  },
  {
    pattern: "alternate-win package",
    reason:
      "Alternate-win packages require dedicated deck construction and rules surfaces outside this launch pool.",
  },
  {
    pattern: "unconditional opening-hand discard",
    reason:
      "Unconditional opening-hand attacks are excluded; combat-earned discard remains interactive.",
  },
  {
    pattern: "delayed self-revival after destruction",
    reason:
      "Delayed self-revival after effect destruction needs a visible pending-effect rules surface before it can be added cleanly.",
  },
  {
    pattern: "blanket monster-effect negation",
    reason:
      "Blanket Monster-effect negation would erase too much of the deliberately limited 23% Effect Monster roster.",
  },
]);
