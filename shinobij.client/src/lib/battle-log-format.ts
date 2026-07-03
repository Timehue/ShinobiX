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

// A small monochrome glyph per category so an effect line leads with its TYPE —
// players can scan "what happened" (heal vs damage vs shield …) at a glance
// instead of parsing every word. The glyph inherits the category color via CSS
// (it lives inside the .battle-log-<category> line), so it stays subtle.
const CATEGORY_GLYPH: Readonly<Record<BattleLogCategory, string>> = {
    heal: "✚",
    damage: "✸",
    dmgmod: "⇅",
    shield: "❖",
    control: "✦",
    prevent: "⊘",
    tempo: "⟳",
    system: "›",
    effect: "◈",
};

/** Leading glyph for a known category (caller already classified the line). */
export function glyphForCategory(category: BattleLogCategory): string {
    return CATEGORY_GLYPH[category];
}

/** Leading glyph for a line's semantic category (for the effect-line marker). */
export function glyphForBattleLogLine(line: string): string {
    return CATEGORY_GLYPH[classifyBattleLogLine(line)];
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

// ─── Action grouping ────────────────────────────────────────────────────────
// The clarity problem "who did what?" is worst when effect lines float free of
// the action that caused them. Both the PvE arena and the reflection view group
// each action's effect lines under one owner header; PvP historically rendered a
// flat wall of <p>. This groups a round's raw server log lines into discrete
// actions so every screen can render the same owner-attributed block.

export type BattleLogActorRole = "player" | "enemy" | "system";

export type BattleLogAction = {
    role: BattleLogActorRole;
    /** Acting fighter's name; "" for ownerless system lines (round end, etc.). */
    actor: string;
    /** Sequential cast number within the battle (only on real jutsu/attack casts). */
    actionNumber?: number;
    /** Action text with the leading actor name stripped (e.g. "Chidori: …"). */
    headline: string;
    /** The colored effect lines that resulted from this action. */
    effectLines: string[];
};

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Pure system narration (no owner block, no effect children): battle-end,
// forfeits, turn passes, movement, skips, time-limit / HP / draw resolutions.
const SYSTEM_LINE = /⚔|wins!|\bforfeits?\b|ends their turn|moves\.$|dashes\.$|has skipped|Both fighters fall|Time limit|\bby HP\b|\bDraw!/i;

/**
 * Group a round's flat log lines (already `%user`/`%target`-interpolated or not)
 * into owner-attributed actions. A line starts a NEW action when it is a cast
 * ("X uses Y: …"), a basic attack ("X attacks Y …"), or standalone system
 * narration; every other line is an effect of the current action. This is far
 * more robust than the old "startsWith(name) || endsWith(':')" header guess,
 * which mis-split lines like "Naruto's shield blocks 100 damage." into new
 * actions.
 */
export function groupBattleLogActions(
    lines: readonly string[],
    selfName: string,
    oppName: string,
    startActionNumber = 0,
): { actions: BattleLogAction[]; nextActionNumber: number } {
    const actions: BattleLogAction[] = [];
    let act = startActionNumber;
    let current: BattleLogAction | null = null;

    const selfRe = new RegExp(`^${escapeRegExp(selfName)}\\b`);
    const oppRe = new RegExp(`^${escapeRegExp(oppName)}\\b`);
    const attackRe = new RegExp(`^(${escapeRegExp(selfName)}|${escapeRegExp(oppName)})\\b.* attacks `, "i");

    for (const raw of lines) {
        const text = interpolateFlavor(raw, selfName, oppName).trim();
        if (!text || /^--- Round \d+ ---$/i.test(text)) continue;

        const roleOf = (): BattleLogActorRole =>
            selfRe.test(text) ? "player" : oppRe.test(text) ? "enemy" : "system";

        const usesMatch = text.match(/^(.+?) uses (.+)$/i);
        if (usesMatch) {
            act += 1;
            current = { role: roleOf(), actor: usesMatch[1]!.trim(), actionNumber: act, headline: usesMatch[2]!.trim(), effectLines: [] };
            actions.push(current);
            continue;
        }
        if (attackRe.test(text)) {
            act += 1;
            const actor = selfRe.test(text) ? selfName : oppName;
            current = { role: roleOf(), actor, actionNumber: act, headline: text.slice(actor.length).replace(/^[\s:]+/, ""), effectLines: [] };
            actions.push(current);
            continue;
        }
        if (SYSTEM_LINE.test(text)) {
            current = { role: roleOf(), actor: "", headline: text, effectLines: [] };
            actions.push(current);
            continue;
        }
        // Effect line — belongs to the current action (or a fresh system group).
        if (!current) {
            current = { role: "system", actor: "", headline: "", effectLines: [] };
            actions.push(current);
        }
        current.effectLines.push(text);
    }

    return { actions, nextActionNumber: act };
}
