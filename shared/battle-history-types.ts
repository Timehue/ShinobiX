export type BattleHistoryActorRole = "player" | "enemy" | "system";

/** One owner-attributed action within a stored battle log. */
export type BattleHistoryAction = {
    round: number;
    role: BattleHistoryActorRole;
    /** Acting fighter's name; "" for ownerless narration (round end, "X wins!"). */
    actor: string;
    /** Sequential cast number within the battle (only on real jutsu/attack casts). */
    actionNumber?: number;
    /** Action text with the leading actor name stripped (e.g. "Lightning Lance: …"). */
    headline: string;
    /** The colored effect lines that resulted from this action. */
    effectLines: string[];
};

/** One recent battle you fought, with its full color-coded log for reflection. */
export type BattleHistoryEntry = {
    id: string;
    /** Battle-ended timestamp (ms epoch). */
    ts: number;
    /** Human label for the mode: "Arena" | "Mission" | "Endless" | "Raid" | "Story" | "PvP" | "Ranked" | "Spar". */
    mode: string;
    opponent: string;
    outcome: "win" | "loss" | "draw" | "flee";
    rounds: number;
    /** Your fighter name at the time (for %user/%target interpolation on replay). */
    self: string;
    actions: BattleHistoryAction[];
};
