/* Chronicle Points from card battles outside Echoes of War (owner request
 * 2026-10-22). The server pays them (api/card-clash/_card-cp.ts) and owns every
 * amount through its dials; this module only holds the code defaults the dials
 * fall back to, and the result shape each card host returns, so the client
 * result copy and the guide read the same numbers as the server. */

/** Code defaults of the CARD_*_CP dials. The live amount on each result is the server's. */
export const CARD_CHRONICLE_POINTS_DEFAULTS = Object.freeze({
    /** A credited PvP card duel win (free play, clan war, sector war). */
    pvpWin: 20,
    /** A credited PvP card duel loss in which the loser played the duel out. */
    pvpLoss: 8,
    /** A won Dungeon Card seal. */
    dungeon: 10,
    /** A won Hollow Gate (Rift) card ambush. */
    gate: 10,
    /** A won sector-war garrison assault. */
    garrison: 15,
});

/** Why a decided card duel paid no Chronicle Points to this player. */
export type CardChroniclePointsReason =
    /** Too short, too few plays from one side, before turn 3, or ended by a forfeit or the clock. */
    | 'participation'
    /** The pair is trading wins back and forth. */
    | 'reciprocal'
    /** This pair already used its credited duels for the UTC day. */
    | 'repeat'
    /** The losing account is not yet established (under 72 hours old and below level 20). */
    | 'too-young';

/** The thresholds a duel must meet to pay, as the server applied them. */
export type CardChroniclePointsRules = {
    minSeconds: number;
    minActionsPerSide: number;
    minTurn: number;
};

/** What one finished card battle paid the player viewing it. */
export type CardChroniclePointsView = {
    /** Chronicle Points credited (or sealed and still being credited) to this player. */
    earned: number;
    status: 'paid' | 'pending' | 'none';
    reason?: CardChroniclePointsReason;
    /** The per-opponent share for the day: 1, 1, 0.5, 0.25, then 0. PvP only. */
    pairWeight?: number;
    rules?: CardChroniclePointsRules;
};
