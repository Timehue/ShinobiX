export type CombatStatusTone = "positive" | "negative";
export type CombatStatusCategory = "Buff" | "Debuff" | "Control" | "Shield" | "Neutral";

export type ReadableCombatStatus = {
    name: string;
    kind?: CombatStatusTone;
    source?: string;
};

export type CombatStatusSemantics = {
    category: CombatStatusCategory;
    icon: string;
    source: string;
    removal: string;
    effect: string;
};

export function combatStatusDuration(minRounds: number, maxRounds: number, compact = false): string {
    if (minRounds !== maxRounds) return `${minRounds}\u2013${maxRounds}${compact ? "r" : " rounds"}`;
    return compact ? `${maxRounds}r` : `${maxRounds} round${maxRounds === 1 ? "" : "s"}`;
}

const CONTROL_NAMES = new Set([
    "stun",
    "lag",
    "root",
    "freeze",
    "sleep",
    "silence",
    "taunt",
    "move lock",
    "bloodline seal",
    "elemental seal",
    "buff prevent",
    "cleanse prevent",
]);

const SHIELD_NAMES = new Set([
    "absorb",
    "reflect",
    "barrier",
    "shield",
    "debuff prevent",
    "clear prevent",
    "stun prevent",
]);

const EFFECT_COPY: Record<string, string> = {
    stun: "Reduces the next action window",
    lag: "Raises action costs",
    poison: "Jutsu use causes damage",
    wound: "Deals ongoing HP damage",
    drain: "Drains combat resources",
    recoil: "Returns damage on attacks",
    absorb: "Converts incoming damage into healing",
    reflect: "Returns incoming damage",
    lifesteal: "Restores HP from damage dealt",
    barrier: "Blocks movement through a hex",
    ignition: "Increases damage taken",
    "bloodline seal": "Suppresses bloodline effects",
    "elemental seal": "Prevents elemental jutsu",
    "buff prevent": "Prevents new buffs",
    "debuff prevent": "Blocks new debuffs",
    "cleanse prevent": "Prevents Cleanse",
    "clear prevent": "Prevents Clear",
    "stun prevent": "Prevents Stun",
    overclock: "Lowers action costs",
};

function normalizedName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function combatStatusSemantics(status: ReadableCombatStatus): CombatStatusSemantics {
    const normalized = normalizedName(status.name);
    const kind = status.kind;
    const category: CombatStatusCategory = CONTROL_NAMES.has(normalized)
        ? "Control"
        : SHIELD_NAMES.has(normalized)
            ? "Shield"
            : kind === "positive"
                ? "Buff"
                : kind === "negative"
                    ? "Debuff"
                    : "Neutral";

    const preventsOwnRemoval = normalized === "cleanse prevent" || normalized === "clear prevent";
    const removal = preventsOwnRemoval
        ? "Expires naturally"
        : kind === "negative"
            ? "Cleanse removes"
            : kind === "positive"
                ? "Clear removes"
                : "Expires naturally";

    return {
        category,
        icon: category === "Buff" ? "↑" : category === "Debuff" ? "↓" : category === "Control" ? "◎" : category === "Shield" ? "◆" : "•",
        source: status.source?.trim() || "Combat effect",
        removal,
        effect: EFFECT_COPY[normalized] ?? (kind === "positive" ? "Improves combat capability" : kind === "negative" ? "Impairs combat capability" : "Changes combat state"),
    };
}
