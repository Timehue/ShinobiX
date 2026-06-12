/*
 * Battle-log line colorizer — classifies a single combat-log line into a
 * semantic category so the UI can color-code it, and splits out numeric tokens
 * so damage / heal / percent values can be emphasized.
 *
 * Both the PvE arena (Arena.tsx) and the PvP battle screen (PvpBattleScreen.tsx)
 * render their logs as plain strings — PvE builds them locally, PvP receives
 * them verbatim from the server (api/pvp/move.ts). This module is the SINGLE
 * source of truth for log coloring across both, so the two stay consistent
 * without changing the server log format. Pure + dependency-free (testable).
 *
 * Color intent (see battle-skin.css .battle-log-*):
 *   • heal    → green   (HP restored / lifesteal / absorb-into-heal / siphon)
 *   • damage  → red     (direct damage, DoT ticks: poison / wound / drain / recoil / reflected)
 *   • dmgmod  → blue    (Increase/Decrease Damage Given/Taken, Ignition)
 *   • shield  → cyan    (Shield / Barrier / Reflect setup / shield absorption)
 *   • control → amber   (Stun / Push / Pull / Bloodline Seal / Elemental Seal)
 *   • prevent → teal    (Debuff/Buff/Cleanse/Clear/Stun Prevent)
 *   • tempo   → violet  (Copy / Mirror / Lag / Overclock)
 *   • system  → gold    (cast headers, round separators, win/forfeit/turn-end)
 *   • effect  → lilac   (fallback for anything unmatched)
 */

export type BattleLogCategory =
    | "heal"
    | "damage"
    | "dmgmod"
    | "shield"
    | "control"
    | "prevent"
    | "tempo"
    | "system"
    | "effect";

// Ordered rules — FIRST match wins, so more-specific patterns come earlier.
// The ordering resolves the tricky overlaps:
//   • dmgmod before damage   → "Increase Damage Taken: …N% more damage" is blue, not red
//   • heal before damage     → "Absorb: …converts N% incoming damage" / "absorbs N HP" is green
//   • shield before damage   → "N absorbed by X's shield" / "Reflect:" is cyan
//   • control before damage  → "Stun:" / "…Seal" is amber, not caught by a stray number
const RULES: ReadonlyArray<readonly [RegExp, BattleLogCategory]> = [
    // Structural / narration
    [/^--- Round \d+ ---$/i, "system"],
    [/ uses /i, "system"],
    [/⚔|wins!|\bforfeits?\b|ends their turn|^.+ moves\.$|^.+ dashes\.$|has skipped|Both fighters fall|Time limit|\bby HP\b|\bDraw!/i, "system"],

    // Damage modifiers (blue) — before generic "damage"
    [/Damage (Given|Taken)/i, "dmgmod"],
    [/\bIgnition\b/i, "dmgmod"],

    // Healing (green) — before "damage" so Absorb/Lifesteal/Siphon don't read as red
    [/^Heal:|^Increase Heal:|^Siphon:|^Lifesteal:|^Absorb:|restores [\d,]+ HP|heals (?:on hit|[\d,]+)|absorbs [\d,]+ HP|steals [\d,]+ HP|converts [\d,]+% incoming|will heal/i, "heal"],

    // Shields / barriers (cyan)
    [/^Shield:|^Barrier:|^Reflect:|shield blocks|gains [\d,]+ shield|absorbed by .*shield/i, "shield"],

    // Prevents / protections (teal)
    [/\bPrevent\b/i, "prevent"],

    // Tempo / copy effects (violet)
    [/^Copy:|^Mirror:|^Lag:|^Overclock:/i, "tempo"],

    // Crowd control (amber)
    [/^Stun:|^Push:|^Pull:|\bSeal\b|loses \d+ AP/i, "control"],

    // Damage (red) — generic, last among the semantic rules
    [/[\d,]+ damage|^Damage Dealt:|^Poison:|^Drain:|^Wound:|^Recoil:|^Pierce:|\bbleeds\b|Poison damage|\bdrained\b|reflected damage|recoil/i, "damage"],
];

/** Classify a single battle-log line into a semantic color category. */
export function classifyBattleLogLine(line: string): BattleLogCategory {
    const text = line.trim();
    if (!text) return "effect";
    for (const [pattern, category] of RULES) {
        if (pattern.test(text)) return category;
    }
    return "effect";
}

/**
 * Substitute the %user / %target name tokens that jutsu battle flavor may carry
 * (normalizeJutsu's default is `<name> strikes %target`, and the admin editor
 * defaults to `<name> hits %target`). There is no interpolation elsewhere, so
 * flavor is substituted at display time — call this wherever battleDescription
 * is shown so the raw token never leaks into the log.
 */
export function interpolateFlavor(text: string, user: string, target: string): string {
    return text.replace(/%user/g, user).replace(/%target/g, target);
}

export type BattleLogSegment = { text: string; isNumber: boolean };

// A numeric token: an optional leading "~" (approx), digits with optional commas
// and decimals, and an optional trailing "%". Captures "750", "1,355", "30%",
// "~200", "40 AP" (just the "40"). Stateless per call (built fresh each time).
const NUMBER_TOKEN = /~?\d[\d,]*(?:\.\d+)?%?/g;

/**
 * Split a line into plain-text and numeric segments so the renderer can
 * emphasize the numbers (damage / heal amounts / percentages) in the line's
 * category color.
 */
export function tokenizeBattleLogLine(line: string): BattleLogSegment[] {
    const text = line.trim();
    const segments: BattleLogSegment[] = [];
    let lastIndex = 0;
    for (const match of text.matchAll(NUMBER_TOKEN)) {
        const start = match.index ?? 0;
        if (start > lastIndex) segments.push({ text: text.slice(lastIndex, start), isNumber: false });
        segments.push({ text: match[0], isNumber: true });
        lastIndex = start + match[0].length;
    }
    if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), isNumber: false });
    return segments;
}
