import type { CardChroniclePointsView } from "../../../shared/card-chronicle-points";

export type { CardChroniclePointsView };

/** Read the server's Chronicle Point result off a card host reply, tolerating junk. */
export function parseCardChroniclePoints(raw: unknown): CardChroniclePointsView | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const earned = Number(value.earned);
    if (!Number.isFinite(earned) || earned < 0) return null;
    if (value.status !== "paid" && value.status !== "pending" && value.status !== "none") return null;
    return value as unknown as CardChroniclePointsView;
}

/**
 * The one line a finished card duel's result panel shows about Chronicle
 * Points, or null when there is nothing to say (a draw, a watcher). Every
 * threshold it names comes from the server's own result, so the copy cannot
 * drift from the rule that was applied.
 */
export function cardChroniclePointsLine(view: CardChroniclePointsView | null | undefined): string | null {
    if (!view) return null;
    if (view.earned > 0) {
        const repeat = view.pairWeight !== undefined && view.pairWeight < 1 ? " Repeat opponent today, so the reward is reduced." : "";
        return view.status === "paid"
            ? `+${view.earned} Chronicle Points.${repeat}`
            : `+${view.earned} Chronicle Points are being recorded.${repeat}`;
    }
    if (view.status === "pending") return "Chronicle Points are being recorded.";
    if (view.reason === "participation") {
        const rules = view.rules;
        return rules
            ? `No Chronicle Points: a duel counts when it reaches turn ${rules.minTurn}, lasts ${rules.minSeconds} seconds, has ${rules.minActionsPerSide} plays from each side, and ends without a forfeit or timeout.`
            : "No Chronicle Points: the duel ended too soon or by a forfeit or timeout.";
    }
    if (view.reason === "reciprocal") return "No Chronicle Points: wins traded back and forth with one opponent do not count.";
    if (view.reason === "repeat") return "No Chronicle Points: duels with this opponent have paid all they can today.";
    if (view.reason === "too-young") return "No Chronicle Points: an account under 72 hours old and below level 20 was in this duel.";
    if (view.reason === "level-gap") return "No Chronicle Points: the winner was more than 20 levels above the loser.";
    return null;
}
