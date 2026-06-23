/*
 * Shared client-side PvP-battle + leaderboard/tavern UI types.
 *
 * Drained verbatim from App.tsx (which sits at its line-budget ceiling). These
 * mirror the server's PvpSession shape the same way the repo duplicates
 * server↔client combat types elsewhere. App.tsx imports PvpSessionState back for
 * its own use and re-exports the public ones, so external `import … from "../App"`
 * sites (HallOfLegends, PvpBattleScreen, StartScreen, VillageTavern) keep
 * resolving identically.
 */

import type { JutsuTag } from "./combat";
import type { Biome } from "./core";

export type LbTab = "ranked" | "kills" | "xp" | "clans" | "pets" | "gauntlet" | "endless" | "villageWars" | "weeklyBoss" | "tournament" | "professions" | "bounties";

export type TavernMessage = { author: string; text: string; ts: number; rank?: string; customTitle?: string; level?: number };

type PvpStatusState = {
    name: string;
    rounds: number;
    percent?: number;
    amount?: number;
    kind: "positive" | "negative";
};

type PvpFighterState = {
    name: string;
    hp: number;
    maxHp: number;
    chakra: number;
    maxChakra: number;
    stamina: number;
    maxStamina: number;
    shield: number;
    statuses: PvpStatusState[];
    character: Record<string, unknown>;
    pos: number;
};

export type PvpGroundEffectState = {
    id: string;
    owner: "p1" | "p2";
    name: string;
    tiles: number[];
    rounds: number;
    tags: JutsuTag[];
};

export type PvpSessionState = {
    battleId: string;
    p1: PvpFighterState;
    p2: PvpFighterState;
    round: number;
    activePlayer: "p1" | "p2";
    ap: { p1: number; p2: number };
    actionsThisTurn: number;
    cooldowns: { p1: Record<string, number>; p2: Record<string, number> };
    groundEffects?: PvpGroundEffectState[];
    log: string[];
    status: "active" | "done";
    winner: "p1" | "p2" | "draw" | null;
    fleedBy?: "p1" | "p2";
    createdAt?: number;
    lastMoveAt?: number;
    consecAutoWait?: { p1?: number; p2?: number };
    // Environment sealed at session-create time (api/pvp/session.ts). The server
    // resolves terrain/weather damage modifiers from THESE, so the battle UI
    // reads them too — display + preview match server math (ranked seals
    // 'central' / no weather regardless of where the fighters are standing).
    biome?: Biome;
    weatherPositiveElement?: string;
    weatherNegativeElement?: string;
    // Response-only on a /api/pvp/move reply when the submitted action was
    // rejected (never persisted / never on GET/SSE). The battle screen surfaces
    // `reason` and keeps the player's pending selection so they can adjust.
    rejected?: { applied: false; reason: string; serverRound: number; activePlayer: "p1" | "p2" };
};
