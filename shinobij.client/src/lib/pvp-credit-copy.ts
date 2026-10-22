import type { PvpRewardCredit } from "./progression";

/**
 * Player-facing line explaining why a PvP fight paid less than the full purse
 * (owner ruling A9, 2026-10-21: every limit is visible where it applies). The
 * server decides; this only words the decision it returned on the claim.
 * Returns null for a full-credit fight.
 */
export function pvpCreditNote(credit: PvpRewardCredit | undefined, role: "win" | "loss"): string | null {
    if (!credit) return null;
    if (!credit.credited) {
        return credit.reason === "level-gap"
            ? "No pay: the winner was more than 20 levels above the loser."
            : "No pay: an account under 72 hours old and below level 20 was in this fight.";
    }
    const notes: string[] = [];
    if (credit.pairWeight <= 0) {
        notes.push(`Fight ${credit.pairOrdinal} with this opponent today: no further pay until tomorrow (UTC).`);
    } else if (credit.pairWeight < 1) {
        notes.push(`Fight ${credit.pairOrdinal} with this opponent today: ${Math.round(credit.pairWeight * 100)}% pay.`);
    }
    if (role === "win" && credit.short) {
        notes.push(credit.kind === "flee" || credit.kind === "afk"
            ? "The opponent fled or idled before 3 rounds and 60 seconds: no pay."
            : `Short fight (under 3 rounds or 60 seconds): ${Math.round(credit.sideMult * 100)}% pay.`);
    }
    if (role === "loss" && credit.sideMult <= 0 && credit.pairWeight > 0) {
        notes.push("Loss pay needs 3 rounds, 60 seconds and 15% of the winner's HP in damage.");
    }
    return notes.length ? notes.join(" ") : null;
}
