import type { AiFightBattleKind } from "./ai-fight-api";

/*
 * AI-fight launch bus (mirrors lib/story-fight-theme's requestStoryBossFight).
 *
 * Every launch site that fights a CATALOG AI — hunts, apex, village guards,
 * wanderers, explore ambushes, sector raids, field/E-rank missions — emits one
 * request here instead of arranging the local Arena itself. The single host
 * (components/AiFightHost, mounted once in App) starts the sealed fight and
 * routes it onto the standalone server-combat screen. If the App host is absent,
 * the request fails closed and no combat or reward is resolved on the client.
 *
 * ORDERING: the fight is started BEFORE the battle screen is chosen. The old
 * path minted its token from inside the battle (a `battleStarted` effect in
 * Arena), so the runId only arrived once the local fight was already underway —
 * too late to route anything.
 */

export type AiFightRequest = {
    /** Published catalog/admin AI id. */
    opponentId: string;
    /** The level the fight is fought at — sealed onto the reward token. */
    opponentLevel: number;
    battleKind: AiFightBattleKind;
    /** Display-only: the dossier name on the server-combat screen. */
    opponentName?: string;
    /** Display-only: the enemy portrait on the server-combat screen. */
    enemyAvatar?: string;
    /**
     * The sector this fight is fought over. Drives the raid side effects the
     * server does NOT own (sector territory damage, mission raid credit), so it
     * must be the sector the caller set, not whatever the map drifts to later.
     */
    sector?: number;
    /** Where the player returns to when the server fight closes. */
    returnScreen?: string;
};

type Listener = (request: AiFightRequest) => void;
let listener: Listener | null = null;

/** Host registration (single subscriber — the App-mounted AiFightHost). */
export function onAiFightRequest(fn: Listener): () => void {
    listener = fn;
    return () => { if (listener === fn) listener = null; };
}

/**
 * Launch one AI fight through the host. Returns false when no host is mounted;
 * callers use that only for diagnostics because App owns the singleton host.
 */
export function requestAiFight(request: AiFightRequest): boolean {
    if (!listener) return false;
    listener(request);
    return true;
}
