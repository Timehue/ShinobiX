import type { PvpRewardCredit } from "./progression";

/** The code defaults, used when a reply carries no `rules` (an older server). */
const DEFAULT_RULES: NonNullable<PvpRewardCredit["rules"]> = {
    minRounds: 3,
    minFightSeconds: 60,
    lossMinDamagePct: 15,
    minAccountAgeHours: 72,
    establishedLevel: 20,
    levelGapMax: 20,
};

/**
 * Player-facing line explaining why a PvP fight paid less than the full purse
 * (owner ruling A9, 2026-10-21: every limit is visible where it applies). The
 * server decides and sends the live thresholds; this only words the decision.
 * Returns null for a full-credit fight.
 */
export function pvpCreditNote(credit: PvpRewardCredit | undefined, role: "win" | "loss"): string | null {
    if (!credit) return null;
    const rules = { ...DEFAULT_RULES, ...(credit.rules ?? {}) };
    const floor = `${rules.minRounds} rounds and ${rules.minFightSeconds} seconds`;
    if (!credit.credited) {
        return credit.reason === "level-gap"
            ? `No pay: the winner was more than ${rules.levelGapMax} levels above the loser.`
            : `No pay: an account under ${rules.minAccountAgeHours} hours old and below level ${rules.establishedLevel} was in this fight.`;
    }
    const notes: string[] = [];
    if (credit.pairWeight <= 0) {
        notes.push(`Fight ${credit.pairOrdinal} with this opponent today: no further pay until tomorrow (UTC).`);
    } else if (credit.pairWeight < 1) {
        notes.push(`Fight ${credit.pairOrdinal} with this opponent today: ${Math.round(credit.pairWeight * 100)}% pay.`);
    }
    if (role === "win" && credit.short) {
        notes.push(credit.kind === "flee" || credit.kind === "afk"
            ? `The opponent fled or idled before ${floor}: no pay.`
            : `Short fight (under ${rules.minRounds} rounds or ${rules.minFightSeconds} seconds): ${Math.round(credit.sideMult * 100)}% pay.`);
    }
    if (role === "loss" && credit.sideMult <= 0 && credit.pairWeight > 0) {
        notes.push(`Loss pay needs ${floor}, and ${rules.lossMinDamagePct}% of the winner's HP in damage.`);
    }
    return notes.length ? notes.join(" ") : null;
}
